// Shared media-understanding provider, attachment, output, and capability contracts.

/** Kind of media-understanding output produced for an attachment. */
export type MediaUnderstandingKind =
  | "audio.transcription"
  | "video.description"
  | "image.description";

/** Capability exposed by a media-understanding provider. */
export type MediaUnderstandingCapability = "image" | "audio" | "video";

/** Capability registry keyed by provider id. */
export type MediaUnderstandingCapabilityRegistry = Map<
  string,
  {
    capabilities?: MediaUnderstandingCapability[];
  }
>;

/** Media attachment passed to understanding providers. */
export type MediaAttachment = {
  path?: string;
  url?: string;
  mime?: string;
  index: number;
  alreadyTranscribed?: boolean;
};

/** Attribution source for a speaker segment. */
export type SpeakerSegmentAttributionSource =
  | "discord_user_stream"
  | "asr_diarize"
  | "sortformer"
  | "manual"
  | "enrollment"
  | "unknown";

/** Audio source family for a speaker segment. */
export type SpeakerSegmentSource =
  | "discord_voice"
  | "telegram_voice"
  | "youtube"
  | "upload"
  | "podcast"
  | "meeting"
  | "unknown";

/** One word-level timestamp inside a speaker segment. */
export type SpeakerSegmentWord = {
  startMs: number;
  endMs: number;
  word: string;
  confidence?: number;
};

/** Canonical speaker segment: who spoke when, and how we know. */
export type SpeakerSegment = {
  source: SpeakerSegmentSource;
  sourceId: string | null;
  speakerLabel: string;
  speakerDisplayName: string | null;
  speakerConfidence: number | null;
  startMs: number;
  endMs: number;
  text: string;
  words: SpeakerSegmentWord[] | null;
  attributionSource: SpeakerSegmentAttributionSource;
  diarizationModel: string | null;
  asrModel: string | null;
};

/** Normalized text output produced by media understanding. */
export type MediaUnderstandingOutput = {
  kind: MediaUnderstandingKind;
  attachmentIndex: number;
  text: string;
  provider: string;
  model?: string;
  /** Optional speaker-attributed segments; kept additive to preserve plain-text fallback. */
  segments?: SpeakerSegment[];
};

/** Provider shape used for capability discovery and dispatch. */
export type MediaUnderstandingProvider = {
  id: string;
  capabilities?: MediaUnderstandingCapability[];
  transcribeAudio?: unknown;
  describeVideo?: unknown;
  describeImage?: unknown;
  describeImages?: unknown;
  extractStructured?: unknown;
};
