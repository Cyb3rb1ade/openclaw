import type { SpeakerSegment } from "../../../packages/media-understanding-common/src/types.js";
// No-op diarization provider used when provider is "none" or a job is skipped.
import type { AudioDiarizationProvider, AudioDiarizationProviderInput } from "../types.js";

export class NoOpDiarizationProvider implements AudioDiarizationProvider {
  readonly id = "none";

  async diarizeAudio(_input: AudioDiarizationProviderInput): Promise<SpeakerSegment[]> {
    return [];
  }
}
