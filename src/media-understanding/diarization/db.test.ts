// Tests for diarization SQLite persistence.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDiarizationJob,
  findDiarizationJob,
  getDiarizationCacheEntry,
  getDiarizationJobById,
  getQueuedDiarizationJobs,
  resetDiarizationDbForTests,
  setDiarizationCacheEntry,
  updateDiarizationJobState,
} from "./db.js";
import type { DiarizationTargetRef } from "./types.js";

let originalStateDir: string | undefined;
let tmpStateDir: string;

function makeTargetRef(overrides: Partial<DiarizationTargetRef> = {}): DiarizationTargetRef {
  return {
    source: "upload",
    sourceId: null,
    mediaOutputId: "media-output-1",
    transcriptId: null,
    conversationId: null,
    messageId: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<import("./types.js").AudioDiarizationJob> = {}) {
  return {
    id: "job-1",
    audioHash: "abc123",
    source: "upload",
    provider: "mock",
    model: null,
    configVersion: "1",
    state: "queued" as const,
    createdAt: 1,
    updatedAt: 1,
    result: null,
    mergedResult: null,
    asrText: null,
    asrWords: null,
    targetRef: makeTargetRef(),
    errorMessage: null,
    ...overrides,
  };
}

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

describe("diarization db", () => {
  it("creates and retrieves a job", async () => {
    const job = await createDiarizationJob(makeJob());

    const fetched = await getDiarizationJobById(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.state).toBe("queued");
    expect(fetched?.audioHash).toBe("abc123");
    expect(fetched?.targetRef.mediaOutputId).toBe("media-output-1");
  });

  it("finds the newest job by cache key", async () => {
    await createDiarizationJob(
      makeJob({ id: "old", audioHash: "hash1", createdAt: 100, updatedAt: 100 }),
    );
    await createDiarizationJob(
      makeJob({ id: "new", audioHash: "hash1", createdAt: 200, updatedAt: 200 }),
    );

    const found = await findDiarizationJob("hash1", "mock", null, "1");
    expect(found?.id).toBe("new");
  });

  it("updates job state and result", async () => {
    await createDiarizationJob(makeJob());

    await updateDiarizationJobState("job-1", "running");
    let fetched = await getDiarizationJobById("job-1");
    expect(fetched?.state).toBe("running");

    await updateDiarizationJobState("job-1", "completed", {
      result: [{ speakerLabel: "speaker_0" }],
      mergedResult: [{ speakerLabel: "speaker_0", text: "hello" }],
    });
    fetched = await getDiarizationJobById("job-1");
    expect(fetched?.state).toBe("completed");
    expect(fetched?.result).toHaveLength(1);
    expect(fetched?.mergedResult).toHaveLength(1);
  });

  it("lists queued jobs ordered by creation time", async () => {
    await createDiarizationJob(
      makeJob({ id: "b", audioHash: "hash-b", createdAt: 200, updatedAt: 200 }),
    );
    await createDiarizationJob(
      makeJob({ id: "a", audioHash: "hash-a", createdAt: 100, updatedAt: 100 }),
    );

    const queued = await getQueuedDiarizationJobs(10);
    expect(queued.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("stores and retrieves cache entries", async () => {
    await setDiarizationCacheEntry({
      audioHash: "hash1",
      provider: "mock",
      model: null,
      configVersion: "1",
      result: [{ speakerLabel: "speaker_0" }],
      createdAt: 1,
    });

    const cached = await getDiarizationCacheEntry("hash1", "mock", null, "1");
    expect(cached).not.toBeNull();
    expect(cached?.result).toHaveLength(1);
  });
});
