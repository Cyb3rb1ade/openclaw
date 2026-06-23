// Tests for the public diarization API and D3 merge integration.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaUnderstandingOutput } from "../../../packages/media-understanding-common/src/types.js";
import {
  getDiarizationMergeResultByMediaOutputId,
  resetDiarizationDbForTests,
  setDiarizationCacheEntry,
  setDiarizationMergeResult,
} from "./db.js";
import { computeAudioHash } from "./hash.js";
import {
  attachFallbackAndMaybeEnqueueDiarization,
  processDiarizationJob,
  runDiarizationWorker,
} from "./index.js";
import { mergeDiarizationWithAsr } from "./merge.js";
import type { DiarizationTargetRef } from "./types.js";

let originalStateDir: string | undefined;
let tmpStateDir: string;

beforeEach(async () => {
  originalStateDir = process.env.OPENCLAW_STATE_DIR;
  tmpStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-diarization-test-"));
  process.env.OPENCLAW_STATE_DIR = tmpStateDir;
  resetDiarizationDbForTests();
});

afterEach(async () => {
  resetDiarizationDbForTests();
  if (originalStateDir !== undefined) {
    process.env.OPENCLAW_STATE_DIR = originalStateDir;
  } else {
    delete process.env.OPENCLAW_STATE_DIR;
  }
  await fs.rm(tmpStateDir, { recursive: true, force: true });
});

function makeTargetRef(overrides: Partial<DiarizationTargetRef> = {}): DiarizationTargetRef {
  return {
    source: "upload",
    sourceId: null,
    mediaOutputId: "media-output-1",
    ...overrides,
  };
}

function makeAudioOutput(text = "hello world"): MediaUnderstandingOutput {
  return {
    kind: "audio.transcription",
    attachmentIndex: 0,
    text,
    provider: "mock-asr",
  };
}

describe("attachFallbackAndMaybeEnqueueDiarization", () => {
  it("returns output unchanged when provider is none", async () => {
    const output = makeAudioOutput();
    const result = await attachFallbackAndMaybeEnqueueDiarization({
      config: { provider: "none" },
      output,
      buffer: Buffer.from("audio"),
      targetRef: makeTargetRef(),
      asrText: output.text,
    });

    expect(result.segments).toBeUndefined();
  });

  it("enqueues a job and attaches a fallback segment for the mock provider", async () => {
    const output = makeAudioOutput();
    const buffer = Buffer.from("audio-data");
    const result = await attachFallbackAndMaybeEnqueueDiarization({
      config: { provider: "mock" },
      output,
      buffer,
      targetRef: makeTargetRef(),
      asrText: output.text,
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments?.[0]?.speakerLabel).toBe("speaker_0");
    expect(result.segments?.[0]?.attributionSource).toBe("unknown");
  });

  it("uses cached merge result directly when available", async () => {
    const buffer = Buffer.from("cached-audio");
    const audioHash = computeAudioHash(buffer);
    const targetRef = makeTargetRef({ mediaOutputId: "media-output-merge" });

    await setDiarizationMergeResult({
      audioHash,
      diarizationProvider: "mock",
      diarizationModel: null,
      diarizationConfigVersion: "1",
      asrModel: null,
      asrTextHash: computeTextHash("hello world"),
      asrWordsHash: "no-words",
      mergeConfigVersion: "1",
      mediaOutputId: targetRef.mediaOutputId,
      result: [
        {
          source: "unknown",
          sourceId: null,
          speakerLabel: "speaker_1",
          speakerDisplayName: null,
          speakerConfidence: null,
          startMs: 0,
          endMs: 1000,
          text: "hello world",
          words: null,
          attributionSource: "asr_diarize",
          diarizationModel: "mock",
          asrModel: null,
        },
      ],
      createdAt: Date.now(),
    });

    const result = await attachFallbackAndMaybeEnqueueDiarization({
      config: { provider: "mock" },
      output: makeAudioOutput(),
      buffer,
      targetRef,
      asrText: "hello world",
    });

    expect(result.segments?.[0]?.speakerLabel).toBe("speaker_1");
    expect(result.segments?.[0]?.text).toBe("hello world");
  });

  it("runs D3 merge synchronously when raw diarization cache exists", async () => {
    const buffer = Buffer.from("raw-cache-audio");
    const audioHash = computeAudioHash(buffer);
    const targetRef = makeTargetRef({ mediaOutputId: "media-output-sync" });

    await setDiarizationCacheEntry({
      audioHash,
      provider: "mock",
      model: null,
      configVersion: "1",
      result: [
        {
          source: "unknown",
          sourceId: null,
          speakerLabel: "speaker_0",
          speakerDisplayName: null,
          speakerConfidence: null,
          startMs: 0,
          endMs: 2000,
          text: "",
          words: null,
          attributionSource: "asr_diarize",
          diarizationModel: "mock",
          asrModel: null,
        },
        {
          source: "unknown",
          sourceId: null,
          speakerLabel: "speaker_1",
          speakerDisplayName: null,
          speakerConfidence: null,
          startMs: 2000,
          endMs: 4000,
          text: "",
          words: null,
          attributionSource: "asr_diarize",
          diarizationModel: "mock",
          asrModel: null,
        },
      ],
      createdAt: Date.now(),
    });

    const result = await attachFallbackAndMaybeEnqueueDiarization({
      config: { provider: "mock" },
      output: makeAudioOutput("one two three four"),
      buffer,
      targetRef,
      asrText: "one two three four",
    });

    expect(result.segments).toHaveLength(2);
    expect(result.segments?.[0]?.text).toBeTruthy();
    expect(result.segments?.[1]?.text).toBeTruthy();
  });
});

describe("runDiarizationWorker", () => {
  it("processes a queued mock job and runs D3 merge", async () => {
    const buffer = Buffer.from("worker-audio");
    const targetRef = makeTargetRef({ mediaOutputId: "media-output-worker" });
    const config = { provider: "mock", asrModel: "mock-asr" };
    await attachFallbackAndMaybeEnqueueDiarization({
      config,
      output: makeAudioOutput("hello world"),
      buffer,
      targetRef,
      asrText: "hello world",
    });

    await runDiarizationWorker({ config, batchSize: 10 });

    const merged = await getDiarizationMergeResultByMediaOutputId(targetRef.mediaOutputId);
    expect(merged).not.toBeNull();
    expect(merged?.result).toHaveLength(2);
  });

  it("keeps D2 job completed even if D3 merge aborts on oversized text", async () => {
    const buffer = Buffer.from("oversized-text-audio");
    const targetRef = makeTargetRef({ mediaOutputId: "media-output-oversized" });
    const config = { provider: "mock", mergeMaxTextLength: 5 };
    await attachFallbackAndMaybeEnqueueDiarization({
      config,
      output: makeAudioOutput("hello world this is too long"),
      buffer,
      targetRef,
      asrText: "hello world this is too long",
    });

    await runDiarizationWorker({ config, batchSize: 10 });

    const merged = await getDiarizationMergeResultByMediaOutputId(targetRef.mediaOutputId);
    expect(merged).toBeNull();
  });
});

describe("mergeDiarizationWithAsr", () => {
  it("splits text proportionally when no word timestamps exist", () => {
    const segments = [
      makeRawSegment("speaker_0", 0, 1000),
      makeRawSegment("speaker_1", 1000, 3000),
    ];
    const result = mergeDiarizationWithAsr(segments, {
      asrText: "one two three four five six",
    });

    expect(result).toHaveLength(2);
    expect(result[0].text.split(" ")).toHaveLength(2);
    expect(result[1].text.split(" ")).toHaveLength(4);
  });

  it("assigns words to speakers by timestamp", () => {
    const segments = [
      makeRawSegment("speaker_0", 0, 1000),
      makeRawSegment("speaker_1", 1000, 2000),
    ];
    const result = mergeDiarizationWithAsr(segments, {
      asrText: "hello world",
      asrWords: [
        { startMs: 100, endMs: 400, word: "hello" },
        { startMs: 1100, endMs: 1400, word: "world" },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("hello");
    expect(result[1].text).toBe("world");
  });

  it("does not swallow overlapping speech", () => {
    const segments = [makeRawSegment("speaker_0", 0, 1000), makeRawSegment("speaker_1", 500, 1500)];
    const result = mergeDiarizationWithAsr(segments, {
      asrText: "hello world",
      asrWords: [
        { startMs: 100, endMs: 400, word: "hello" },
        { startMs: 700, endMs: 1000, word: "world" },
      ],
      overlapStrategy: "duplicate",
    });

    const texts = result.map((s) => s.text);
    expect(texts.some((t) => t.includes("hello"))).toBe(true);
    expect(texts.some((t) => t.includes("world"))).toBe(true);
  });

  it("aborts on oversized text and throws", () => {
    const segments = [makeRawSegment("speaker_0", 0, 1000)];
    expect(() =>
      mergeDiarizationWithAsr(segments, {
        asrText: "x".repeat(1000),
        maxTextLength: 100,
      }),
    ).toThrow();
  });
});

function makeRawSegment(
  speakerLabel: string,
  startMs: number,
  endMs: number,
): import("./types.js").SpeakerSegment {
  return {
    source: "unknown",
    sourceId: null,
    speakerLabel,
    speakerDisplayName: null,
    speakerConfidence: null,
    startMs,
    endMs,
    text: "",
    words: null,
    attributionSource: "asr_diarize",
    diarizationModel: "mock",
    asrModel: null,
  };
}

function computeTextHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
