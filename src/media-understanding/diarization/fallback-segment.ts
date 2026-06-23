// Fallback speaker segment for audio sources that have not been diarized yet.
import type { SpeakerSegment } from "../../packages/media-understanding-common/src/types.js";

/**
 * Build a safe fallback segment for mixed/unclear audio sources. This avoids
 * assuming a single speaker and gives downstream consumers a valid
 * `SpeakerSegment` shape even before diarization completes.
 */
export function createFallbackSpeakerSegment(
  text: string,
  options: { startMs?: number; endMs?: number } = {},
): SpeakerSegment {
  return {
    source: "unknown",
    sourceId: null,
    speakerLabel: "speaker_0",
    speakerDisplayName: null,
    speakerConfidence: null,
    startMs: options.startMs ?? 0,
    endMs: options.endMs ?? 0,
    text,
    words: null,
    attributionSource: "unknown",
    diarizationModel: null,
    asrModel: null,
  };
}
