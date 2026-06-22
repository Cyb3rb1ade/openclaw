// Async worker for batch audio speaker diarization jobs.
import crypto from "node:crypto";
import type { AudioDiarizationConfig } from "../../config/types.tools.js";
import { logVerbose } from "../../globals.js";
import { logWarn } from "../../logger.js";
import {
  getDiarizationAudio,
  setDiarizationCacheEntry,
  setDiarizationMergeResult,
  updateDiarizationJobState,
} from "./db.js";
import { mergeDiarizationWithAsr } from "./merge.js";
import { getDiarizationProvider } from "./providers/index.js";
import type { AudioDiarizationJob, SpeakerSegmentWord } from "./types.js";

export type DiarizationWorkerOptions = {
  config: AudioDiarizationConfig;
};

function computeTextHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function computeWordsHash(words: SpeakerSegmentWord[] | null): string {
  if (!words || words.length === 0) {
    return "no-words";
  }
  return crypto
    .createHash("sha256")
    .update(words.map((w) => `${w.startMs}:${w.endMs}:${w.word}`).join("|"))
    .digest("hex");
}

/**
 * Process a single diarization job. This function is safe to call from a
 * background worker loop; it never throws. On failure it records the state
 * as `failed` or `timeout` and logs a sanitized warning (no audio content).
 */
export async function processDiarizationJob(
  job: AudioDiarizationJob,
  options: DiarizationWorkerOptions,
): Promise<void> {
  const { config } = options;
  const provider = getDiarizationProvider(config.provider ?? "none");
  if (!provider) {
    await updateDiarizationJobState(job.id, "failed", {
      errorMessage: `Unknown diarization provider: ${config.provider}`,
    });
    return;
  }

  await updateDiarizationJobState(job.id, "running");

  const timeoutMs = config.jobTimeoutMs ?? 300_000;
  const maxDurationSeconds = config.maxDurationSeconds ?? 3600;

  const audioBuffer = await getDiarizationAudio(job.audioHash);
  if (!audioBuffer) {
    await updateDiarizationJobState(job.id, "failed", {
      errorMessage: "Audio buffer not found in cache",
    });
    return;
  }

  let diarizationResult: import("./types.js").SpeakerSegment[];
  try {
    diarizationResult = await Promise.race([
      provider.diarizeAudio({
        buffer: audioBuffer,
        fileName: job.audioHash,
        maxDurationSeconds,
        timeoutMs,
        model: config.model,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);

    await setDiarizationCacheEntry({
      audioHash: job.audioHash,
      provider: job.provider,
      model: job.model,
      configVersion: job.configVersion,
      result: diarizationResult,
      createdAt: Date.now(),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === "timeout";
    const state = isTimeout ? "timeout" : "failed";
    const errorMessage = err instanceof Error ? err.message : String(err);
    logWarn(`Diarization job ${job.id} ${state}: ${errorMessage}`);
    await updateDiarizationJobState(job.id, state, { errorMessage });
    return;
  }

  // D2 completed successfully. Now run D3 merge locally using already available
  // ASR text/words. D3 never calls providers or performs blocking audio work.
  let mergedResult: import("./types.js").SpeakerSegment[] | undefined;
  try {
    mergedResult = mergeDiarizationWithAsr(diarizationResult, {
      asrText: job.asrText ?? "",
      asrWords: job.asrWords,
      maxTextLength: config.mergeMaxTextLength,
      minSegmentMs: config.mergeMinSegmentMs,
      mergeGapMs: config.mergeGapMs,
      overlapStrategy: config.mergeOverlapStrategy,
    });

    const asrTextHash = computeTextHash(job.asrText ?? "");
    const asrWordsHash = computeWordsHash(job.asrWords ?? null);
    await setDiarizationMergeResult({
      audioHash: job.audioHash,
      diarizationProvider: job.provider,
      diarizationModel: job.model,
      diarizationConfigVersion: job.configVersion,
      asrModel: config.asrModel ?? null,
      asrTextHash,
      asrWordsHash,
      mergeConfigVersion: config.mergeConfigVersion ?? "1",
      mediaOutputId: job.targetRef.mediaOutputId,
      result: mergedResult,
      createdAt: Date.now(),
    });
  } catch (mergeErr) {
    const message = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
    logVerbose(`Diarization job ${job.id} merge failed, keeping raw result: ${message}`);
  }

  await updateDiarizationJobState(job.id, "completed", {
    result: diarizationResult,
    mergedResult,
  });
}
