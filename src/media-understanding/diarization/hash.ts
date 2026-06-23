// Audio hash utility for diarization job/cache lookup.
import crypto from "node:crypto";

/**
 * Compute a stable SHA-256 hash over an audio buffer.
 *
 * In the long term this should hash a normalized WAV payload (mono/16kHz/16bit)
 * so that the same audio in different containers shares a cache key. For D2 the
 * original buffer hash is sufficient and avoids a mandatory ffmpeg pass on every
 * ingest.
 */
export function computeAudioHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
