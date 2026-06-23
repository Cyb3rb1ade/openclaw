// Tests for the D4 speaker mapping layer.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDiarizationDbForTests } from "./db.js";
import {
  applySpeakerMappings,
  clearSpeakerMapping,
  confirmSpeakerProposal,
  getConfirmedMappings,
  getPendingProposals,
  recordSpeakerProposal,
  resolveSpeakerDisplayName,
  setManualSpeakerMapping,
} from "./mapping.js";

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

describe("speaker mapping API", () => {
  it("stores and resolves a manual mapping", async () => {
    await setManualSpeakerMapping("agent-1", "speaker_0", "Nina");
    const displayName = await resolveSpeakerDisplayName("agent-1", "speaker_0");
    expect(displayName).toBe("Nina");
  });

  it("records a proposal and keeps it unconfirmed", async () => {
    await recordSpeakerProposal({
      agentId: "agent-1",
      speakerLabel: "speaker_1",
      displayName: "Paul",
      confidence: 0.7,
      contextHint: "Hi Paul",
    });
    const pending = await getPendingProposals("agent-1");
    expect(pending).toHaveLength(1);
    expect(pending[0].speakerDisplayName).toBe("Paul");
    expect(pending[0].confirmed).toBe(0);

    const displayName = await resolveSpeakerDisplayName("agent-1", "speaker_1");
    expect(displayName).toBeNull();
  });

  it("confirms a proposal", async () => {
    await recordSpeakerProposal({
      agentId: "agent-1",
      speakerLabel: "speaker_1",
      displayName: "Paul",
      confidence: 0.7,
    });
    const ok = await confirmSpeakerProposal("agent-1", "speaker_1");
    expect(ok).toBe(true);
    const displayName = await resolveSpeakerDisplayName("agent-1", "speaker_1");
    expect(displayName).toBe("Paul");
  });

  it("does not overwrite a confirmed mapping with a proposal", async () => {
    await setManualSpeakerMapping("agent-1", "speaker_0", "Nina");
    await recordSpeakerProposal({
      agentId: "agent-1",
      speakerLabel: "speaker_0",
      displayName: "Eva",
      confidence: 0.9,
    });
    const displayName = await resolveSpeakerDisplayName("agent-1", "speaker_0");
    expect(displayName).toBe("Nina");
  });

  it("applies confirmed mappings to segments", async () => {
    await setManualSpeakerMapping("agent-1", "speaker_0", "Nina");
    const segments = [
      {
        source: "unknown" as const,
        sourceId: null,
        speakerLabel: "speaker_0",
        speakerDisplayName: null,
        speakerConfidence: null,
        startMs: 0,
        endMs: 1000,
        text: "hello",
        words: null,
        attributionSource: "asr_diarize" as const,
        diarizationModel: "mock",
        asrModel: null,
      },
      {
        source: "unknown" as const,
        sourceId: null,
        speakerLabel: "speaker_1",
        speakerDisplayName: null,
        speakerConfidence: null,
        startMs: 1000,
        endMs: 2000,
        text: "hi",
        words: null,
        attributionSource: "asr_diarize" as const,
        diarizationModel: "mock",
        asrModel: null,
      },
    ];
    const result = await applySpeakerMappings("agent-1", segments);
    expect(result[0].speakerDisplayName).toBe("Nina");
    expect(result[1].speakerDisplayName).toBeNull();
  });

  it("clears a mapping", async () => {
    await setManualSpeakerMapping("agent-1", "speaker_0", "Nina");
    await clearSpeakerMapping("agent-1", "speaker_0");
    const displayName = await resolveSpeakerDisplayName("agent-1", "speaker_0");
    expect(displayName).toBeNull();
  });
});
