/**
 * Public SDK subpath for transcript source provider types and registry lookup.
 */
export type {
  SpeakerSegment,
  TranscriptImportRequest,
  TranscriptParticipant,
  TranscriptSessionDescriptor,
  TranscriptSourceKind,
  TranscriptSourceLocator,
  TranscriptSourceProvider,
  TranscriptSourceStatus,
  TranscriptStartRequest,
  TranscriptsStartResult,
  TranscriptStopRequest,
  TranscriptsStopResult,
  TranscriptUtterance,
} from "../transcripts/provider-types.js";
export {
  getTranscriptSourceProvider,
  listTranscriptSourceProviders,
  normalizeTranscriptSourceProviderId,
} from "../transcripts/provider-registry.js";
