// Diarization provider registry.
import type { AudioDiarizationProvider } from "../types.js";
import { MockDiarizationProvider } from "./mock.js";
import { NoOpDiarizationProvider } from "./noop.js";
import { SortformerDiarizationProvider } from "./sortformer.js";

const providers: Record<string, AudioDiarizationProvider> = {
  none: new NoOpDiarizationProvider(),
  mock: new MockDiarizationProvider(),
  sortformer: new SortformerDiarizationProvider(),
};

export function getDiarizationProvider(providerId: string): AudioDiarizationProvider | undefined {
  return providers[providerId];
}

export function registerDiarizationProvider(
  providerId: string,
  provider: AudioDiarizationProvider,
): void {
  providers[providerId] = provider;
}
