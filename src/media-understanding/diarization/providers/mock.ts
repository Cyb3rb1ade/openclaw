import type { SpeakerSegment } from "../../../packages/media-understanding-common/src/types.js";
// Mock diarization provider for tests. Splits the audio duration into two
// deterministic speaker segments so D2 infrastructure can be exercised without
// an external diarization service.
import type { AudioDiarizationProvider, AudioDiarizationProviderInput } from "../types.js";

export class MockDiarizationProvider implements AudioDiarizationProvider {
  readonly id = "mock";

  async diarizeAudio(input: AudioDiarizationProviderInput): Promise<SpeakerSegment[]> {
    const durationMs = Math.max(2000, (input.maxDurationSeconds ?? 60) * 1000);
    const mid = Math.floor(durationMs / 2);
    const now = Date.now();
    return [
      {
        source: "unknown",
        sourceId: null,
        speakerLabel: "speaker_0",
        speakerDisplayName: null,
        speakerConfidence: null,
        startMs: 0,
        endMs: mid,
        text: "",
        words: null,
        attributionSource: "asr_diarize",
        diarizationModel: this.id,
        asrModel: null,
      },
      {
        source: "unknown",
        sourceId: null,
        speakerLabel: "speaker_1",
        speakerDisplayName: null,
        speakerConfidence: null,
        startMs: mid,
        endMs: durationMs,
        text: "",
        words: null,
        attributionSource: "asr_diarize",
        diarizationModel: this.id,
        asrModel: null,
      },
    ];
  }
}
