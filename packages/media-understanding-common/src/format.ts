// Media Understanding Common helper module supports format behavior.
import type { MediaUnderstandingOutput, SpeakerSegment } from "./types.js";

const MEDIA_PLACEHOLDER_RE = /^<media:[^>]+>(\s*\([^)]*\))?$/i;
const MEDIA_PLACEHOLDER_TOKEN_RE = /^<media:[^>]+>(\s*\([^)]*\))?\s*/i;

/** Extracts user-authored text while ignoring synthetic media placeholder tokens. */
export function extractMediaUserText(body?: string): string | undefined {
  const trimmed = body?.trim() ?? "";
  if (!trimmed) {
    return undefined;
  }
  if (MEDIA_PLACEHOLDER_RE.test(trimmed)) {
    return undefined;
  }
  const cleaned = trimmed.replace(MEDIA_PLACEHOLDER_TOKEN_RE, "").trim();
  return cleaned || undefined;
}

function formatSection(
  title: string,
  kind: "Transcript" | "Description",
  text: string,
  userText?: string,
): string {
  const lines = [`[${title}]`];
  if (userText) {
    lines.push(`User text:\n${userText}`);
  }
  lines.push(`${kind}:\n${text}`);
  return lines.join("\n");
}

/** Renders speaker-attributed segments as plain text without assuming identities. */
function formatSpeakerSegments(segments: SpeakerSegment[]): string {
  return segments
    .map((segment) => {
      const name = segment.speakerDisplayName ?? segment.speakerLabel;
      return `[${name}]: ${segment.text}`;
    })
    .join("\n");
}

const MEDIA_OUTPUT_ID_TOKEN_RE = /^<!-- media-output-id: [a-f0-9-]+ -->\n?/i;

/** Returns the best plain-text representation of an audio output. */
function formatAudioTranscriptText(output: MediaUnderstandingOutput): string {
  let body = "";
  if (output.segments && output.segments.length > 0) {
    body = formatSpeakerSegments(output.segments);
  } else {
    body = output.text;
  }
  if (output.mediaOutputId) {
    // Hidden metadata token for downstream enrichment. It is stripped before
    // memory capture and should not affect model behavior.
    return `<!-- media-output-id: ${output.mediaOutputId} -->\n${body}`;
  }
  return body;
}

/** Strip the hidden media-output-id token from a transcript string. */
export function stripMediaOutputIdToken(text: string): string {
  return text.replace(MEDIA_OUTPUT_ID_TOKEN_RE, "");
}

/** Formats media-understanding outputs into the chat body sent back to the model. */
export function formatMediaUnderstandingBody(params: {
  body?: string;
  outputs: MediaUnderstandingOutput[];
}): string {
  const outputs = params.outputs.filter((output) => output.text.trim());
  if (outputs.length === 0) {
    return params.body ?? "";
  }

  const userText = extractMediaUserText(params.body);
  const sections: string[] = [];
  if (userText && outputs.length > 1) {
    sections.push(`User text:\n${userText}`);
  }

  const counts = new Map<MediaUnderstandingOutput["kind"], number>();
  for (const output of outputs) {
    counts.set(output.kind, (counts.get(output.kind) ?? 0) + 1);
  }
  const seen = new Map<MediaUnderstandingOutput["kind"], number>();

  for (const output of outputs) {
    const count = counts.get(output.kind) ?? 1;
    const next = (seen.get(output.kind) ?? 0) + 1;
    seen.set(output.kind, next);
    const suffix = count > 1 ? ` ${next}/${count}` : "";
    if (output.kind === "audio.transcription") {
      sections.push(
        formatSection(
          `Audio${suffix}`,
          "Transcript",
          formatAudioTranscriptText(output),
          outputs.length === 1 ? userText : undefined,
        ),
      );
      continue;
    }
    if (output.kind === "image.description") {
      sections.push(
        formatSection(
          `Image${suffix}`,
          "Description",
          output.text,
          outputs.length === 1 ? userText : undefined,
        ),
      );
      continue;
    }
    sections.push(
      formatSection(
        `Video${suffix}`,
        "Description",
        output.text,
        outputs.length === 1 ? userText : undefined,
      ),
    );
  }

  return sections.join("\n\n").trim();
}

/** Formats one or more audio transcript outputs for legacy transcript-only callers. */
export function formatAudioTranscripts(outputs: MediaUnderstandingOutput[]): string {
  if (outputs.length === 1) {
    return formatAudioTranscriptText(outputs[0]);
  }
  return outputs
    .map((output, index) => `Audio ${index + 1}:\n${formatAudioTranscriptText(output)}`)
    .join("\n\n");
}
