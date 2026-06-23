// Types for batch/non-realtime audio speaker diarization.
import type {
  SpeakerSegment,
  SpeakerSegmentSource,
} from "../../packages/media-understanding-common/src/types.js";

export type AudioDiarizationJobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "skipped";

export type DiarizationTargetRef = {
  source: SpeakerSegmentSource;
  sourceId: string | null;
  /** Stable id for this specific media output; used to retrieve merged segments later. */
  mediaOutputId: string;
  transcriptId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
};

export type SpeakerSegmentWord = {
  startMs: number;
  endMs: number;
  word: string;
  confidence?: number;
};

export type AudioDiarizationJob = {
  id: string;
  audioHash: string;
  source: string;
  provider: string;
  model: string | null;
  configVersion: string;
  state: AudioDiarizationJobState;
  createdAt: number;
  updatedAt: number;
  /** Raw diarization segments (without ASR text). */
  result: SpeakerSegment[] | null;
  /** Final merged segments with text (D3). */
  mergedResult: SpeakerSegment[] | null;
  /** ASR transcript text used for D3 merge. */
  asrText: string | null;
  /** Optional ASR word timestamps used for precise D3 merge. */
  asrWords: SpeakerSegmentWord[] | null;
  /** Concrete target reference so D3 can enrich the right object idempotently. */
  targetRef: DiarizationTargetRef;
  errorMessage: string | null;
};

export type AudioDiarizationProviderInput = {
  /** Raw audio buffer. */
  buffer: Buffer;
  /** Original file name for logging only (no secret content). */
  fileName?: string;
  /** Max duration hint in seconds. */
  maxDurationSeconds?: number;
  /** Timeout for the provider call in milliseconds. */
  timeoutMs?: number;
  /** Provider-specific model id. */
  model?: string;
};

export interface AudioDiarizationProvider {
  readonly id: string;
  diarizeAudio(input: AudioDiarizationProviderInput): Promise<SpeakerSegment[]>;
}

export type AudioDiarizationCacheEntry = {
  audioHash: string;
  provider: string;
  model: string | null;
  configVersion: string;
  result: SpeakerSegment[];
  createdAt: number;
};

export type AudioDiarizationMergeResult = {
  audioHash: string;
  diarizationProvider: string;
  diarizationModel: string | null;
  diarizationConfigVersion: string;
  asrModel: string | null;
  asrTextHash: string;
  asrWordsHash: string;
  mergeConfigVersion: string;
  mediaOutputId: string;
  result: SpeakerSegment[];
  createdAt: number;
};

export type MergeDiarizationOptions = {
  diarizationSegments: SpeakerSegment[];
  asrText: string;
  asrWords?: SpeakerSegmentWord[] | null;
  /** Maximum allowed transcript length; larger inputs abort and keep fallback. */
  maxTextLength?: number;
  /** Minimum segment duration in ms. */
  minSegmentMs?: number;
  /** Gap between same-speaker segments to close. */
  mergeGapMs?: number;
  /** How to handle overlapping segments. */
  overlapStrategy?: "duplicate" | "longest" | "first";
};
