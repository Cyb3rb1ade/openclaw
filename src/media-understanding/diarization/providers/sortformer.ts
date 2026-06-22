import type { SpeakerSegment } from "../../../packages/media-understanding-common/src/types.js";
// Sortformer/NeMo diarization provider stub.
// This is intentionally not wired to a real service yet; it reserves the
// provider id and returns a clear "not implemented" error so the D2
// infrastructure can be tested and extended later without breaking the flow.
import type { AudioDiarizationProvider, AudioDiarizationProviderInput } from "../types.js";

export class SortformerDiarizationProvider implements AudioDiarizationProvider {
  readonly id = "sortformer";

  async diarizeAudio(_input: AudioDiarizationProviderInput): Promise<SpeakerSegment[]> {
    throw new Error(
      "Sortformer/NeMo diarization is not deployed yet. Configure a cloud provider or deploy the local service.",
    );
  }
}
