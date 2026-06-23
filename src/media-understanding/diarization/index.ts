// Public API for batch/non-realtime audio diarization.
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import type { MediaUnderstandingOutput } from "../../../packages/media-understanding-common/src/types.js";
import type { AudioDiarizationConfig } from "../../config/types.tools.js";
import { logVerbose } from "../../globals.js";
import {
  createDiarizationJob,
  findDiarizationJob,
  getDiarizationCacheEntry,
  getDiarizationMergeResult,
  getQueuedDiarizationJobs,
  setDiarizationMergeResult,
  storeDiarizationAudio,
} from "./db.js";
import { createFallbackSpeakerSegment } from "./fallback-segment.js";
import { computeAudioHash } from "./hash.js";
import { mergeDiarizationWithAsr } from "./merge.js";
import { getDiarizationProvider } from "./providers/index.js";
import type { DiarizationTargetRef, SpeakerSegmentWord } from "./types.js";
import { processDiarizationJob } from "./worker.js";

export type { AudioDiarizationJob, AudioDiarizationProvider } from "./types.js";
export { getDiarizationProvider, registerDiarizationProvider } from "./providers/index.js";
export { processDiarizationJob } from "./worker.js";

export type EnqueueDiarizationOptions = {
  config: AudioDiarizationConfig;
  output: MediaUnderstandingOutput;
  buffer: Buffer;
  targetRef: DiarizationTargetRef;
  asrText: string;
  asrWords?: SpeakerSegmentWord[] | null;
};

function computeTextHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function computeWordsHash(words: SpeakerSegmentWord[] | null | undefined): string {
  if (!words || words.length === 0) {
    return "no-words";
  }
  return crypto
    .createHash("sha256")
    .update(words.map((w) => `${w.startMs}:${w.endMs}:${w.word}`).join("|"))
    .digest("hex");
}

function buildMergeCacheKeyParts(
  audioHash: string,
  config: AudioDiarizationConfig,
  asrText: string,
  asrWords: SpeakerSegmentWord[] | null | undefined,
): {
  asrTextHash: string;
  asrWordsHash: string;
} {
  return {
    asrTextHash: computeTextHash(asrText),
    asrWordsHash: computeWordsHash(asrWords),
  };
}

/**
 * Attach a fallback speaker segment to an audio output and, if enabled, enqueue
 * a background diarization job. This function is safe to call from the hot
 * ASR/Ingest path: it does not wait for diarization and only performs local
 * hash + cache checks + a fast SQLite write.
 */
export async function attachFallbackAndMaybeEnqueueDiarization(
  options: EnqueueDiarizationOptions,
): Promise<MediaUnderstandingOutput> {
  const { config, output, buffer, targetRef, asrText, asrWords } = options;

  const providerId = config.provider ?? "none";
  if (providerId === "none") {
    return output;
  }

  const provider = getDiarizationProvider(providerId);
  if (!provider) {
    logVerbose(`diarization: unknown provider "${providerId}", skipping job`);
    return output;
  }

  const audioHash = computeAudioHash(buffer);
  const model = config.model ?? null;
  const configVersion = config.configVersion ?? "1";
  const asrModel = config.asrModel ?? null;
  const mergeConfigVersion = config.mergeConfigVersion ?? "1";
  const { asrTextHash, asrWordsHash } = buildMergeCacheKeyParts(
    audioHash,
    config,
    asrText,
    asrWords,
  );

  // If a merged result already exists for this exact input, use it directly.
  const cachedMerge = await getDiarizationMergeResult(
    audioHash,
    providerId,
    model,
    configVersion,
    asrModel,
    asrTextHash,
    asrWordsHash,
    mergeConfigVersion,
  );
  if (cachedMerge) {
    logVerbose(`diarization: merge cache hit for ${audioHash}`);
    return {
      ...output,
      mediaOutputId: targetRef.mediaOutputId,
      segments: cachedMerge.result,
    };
  }

  // If raw diarization result is already cached, run D3 merge synchronously now
  // (it is purely local and does not call providers or block on audio).
  if (config.cacheEnabled !== false) {
    const cachedDiarization = await getDiarizationCacheEntry(
      audioHash,
      providerId,
      model,
      configVersion,
    );
    if (cachedDiarization && cachedDiarization.result.length > 0) {
      try {
        const merged = mergeDiarizationWithAsr(cachedDiarization.result, {
          asrText,
          asrWords,
          maxTextLength: config.mergeMaxTextLength,
          minSegmentMs: config.mergeMinSegmentMs,
          mergeGapMs: config.mergeGapMs,
          overlapStrategy: config.mergeOverlapStrategy,
        });
        await setDiarizationMergeResult({
          audioHash,
          diarizationProvider: providerId,
          diarizationModel: model,
          diarizationConfigVersion: configVersion,
          asrModel,
          asrTextHash,
          asrWordsHash,
          mergeConfigVersion,
          mediaOutputId: targetRef.mediaOutputId,
          result: merged,
          createdAt: Date.now(),
        });
        return { ...output, mediaOutputId: targetRef.mediaOutputId, segments: merged };
      } catch (err) {
        logVerbose(
          `diarization: synchronous merge failed for ${audioHash}, keeping fallback: ${String(err)}`,
        );
      }
    }
  }

  // Avoid duplicate jobs for the same cache key.
  const existingJob = await findDiarizationJob(audioHash, providerId, model, configVersion);
  if (existingJob) {
    logVerbose(`diarization: existing job ${existingJob.id} for ${audioHash}`);
    return {
      ...output,
      mediaOutputId: targetRef.mediaOutputId,
      segments: [createFallbackSpeakerSegment(asrText)],
    };
  }

  // Persist audio and enqueue job.
  await storeDiarizationAudio(audioHash, buffer);

  const now = Date.now();
  const job = await createDiarizationJob({
    id: randomUUID(),
    audioHash,
    source: targetRef.source,
    provider: providerId,
    model,
    configVersion,
    state: "queued",
    createdAt: now,
    updatedAt: now,
    result: null,
    mergedResult: null,
    asrText,
    asrWords: asrWords ?? null,
    targetRef,
    errorMessage: null,
  });

  logVerbose(`diarization: enqueued job ${job.id} for ${audioHash}`);
  return {
    ...output,
    mediaOutputId: targetRef.mediaOutputId,
    segments: [createFallbackSpeakerSegment(asrText)],
  };
}

export type RunDiarizationWorkerOptions = {
  config: AudioDiarizationConfig;
  /** Maximum number of jobs to process in one call. Default: 10. */
  batchSize?: number;
};

/**
 * Process a batch of queued diarization jobs. This is the async enrichment step
 * that runs after the normal ingest flow has already returned.
 */
export async function runDiarizationWorker(options: RunDiarizationWorkerOptions): Promise<void> {
  const { config, batchSize = 10 } = options;
  const jobs = await getQueuedDiarizationJobs(batchSize);
  for (const job of jobs) {
    await processDiarizationJob(job, { config });
  }
}
