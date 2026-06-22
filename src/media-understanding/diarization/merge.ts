// Local D3 merge: combine raw diarization segments with ASR text/word timestamps.
// This module performs no provider calls, no cloud requests, and no blocking I/O.
import type { MergeDiarizationOptions, SpeakerSegment, SpeakerSegmentWord } from "./types.js";

const DEFAULT_MAX_TEXT_LENGTH = 100_000;
const DEFAULT_MIN_SEGMENT_MS = 200;
const DEFAULT_MERGE_GAP_MS = 500;

/**
 * Merge raw diarization segments with ASR output to produce speaker-attributed
 * segments that contain text. The merge is purely local and aborts safely on
 * oversized input or unexpected errors, leaving the fallback segment valid.
 */
export function mergeDiarizationWithAsr(
  diarizationSegments: SpeakerSegment[],
  options: MergeDiarizationOptions,
): SpeakerSegment[] {
  const {
    asrText,
    asrWords,
    maxTextLength = DEFAULT_MAX_TEXT_LENGTH,
    minSegmentMs = DEFAULT_MIN_SEGMENT_MS,
    mergeGapMs = DEFAULT_MERGE_GAP_MS,
    overlapStrategy = "first",
  } = options;

  if (asrText.length > maxTextLength) {
    throw new Error(
      `ASR text exceeds max allowed length for diarization merge: ${asrText.length} > ${maxTextLength}`,
    );
  }

  if (diarizationSegments.length === 0) {
    return [];
  }

  const sortedSegments = [...diarizationSegments].sort((a, b) => a.startMs - b.startMs);

  let merged: SpeakerSegment[];
  if (asrWords && asrWords.length > 0) {
    merged = mergeWithWordTimestamps(sortedSegments, asrText, asrWords, overlapStrategy);
  } else {
    merged = mergeWithProportionalSplit(sortedSegments, asrText);
  }

  merged = mergeSameSpeakerGaps(merged, mergeGapMs);
  merged = absorbShortSegments(merged, minSegmentMs);

  return merged;
}

function mergeWithWordTimestamps(
  segments: SpeakerSegment[],
  asrText: string,
  words: SpeakerSegmentWord[],
  overlapStrategy: MergeDiarizationOptions["overlapStrategy"],
): SpeakerSegment[] {
  const sortedWords = [...words].sort((a, b) => a.startMs - b.startMs);

  // Determine which diarization segment each word belongs to.
  const wordAssignments: Array<{ word: SpeakerSegmentWord; segmentIndex: number }> = [];
  for (const word of sortedWords) {
    const midpoint = (word.startMs + word.endMs) / 2;
    const overlapping = segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => midpoint >= segment.startMs && midpoint <= segment.endMs);

    if (overlapping.length === 0) {
      // Word outside any segment: keep unassigned marker.
      wordAssignments.push({ word, segmentIndex: -1 });
      continue;
    }

    if (overlapStrategy === "duplicate") {
      for (const { index } of overlapping) {
        wordAssignments.push({ word, segmentIndex: index });
      }
      continue;
    }

    let chosen: number;
    if (overlapStrategy === "longest") {
      const { index } = overlapping.reduce((best, current) => {
        const bestDuration = best.segment.endMs - best.segment.startMs;
        const currentDuration = current.segment.endMs - current.segment.startMs;
        return currentDuration > bestDuration ? current : best;
      });
      chosen = index;
    } else {
      // "first" or default: earliest segment.
      chosen = overlapping[0].index;
    }
    wordAssignments.push({ word, segmentIndex: chosen });
  }

  // Group consecutive words per segment into new segments.
  const result: SpeakerSegment[] = [];
  let current: {
    segmentIndex: number;
    words: SpeakerSegmentWord[];
  } | null = null;

  for (const assignment of wordAssignments) {
    if (!current || current.segmentIndex !== assignment.segmentIndex) {
      if (current) {
        result.push(buildTextSegment(segments, current.segmentIndex, current.words));
      }
      current = { segmentIndex: assignment.segmentIndex, words: [assignment.word] };
    } else {
      current.words.push(assignment.word);
    }
  }
  if (current) {
    result.push(buildTextSegment(segments, current.segmentIndex, current.words));
  }

  return result;
}

function buildTextSegment(
  segments: SpeakerSegment[],
  segmentIndex: number,
  words: SpeakerSegmentWord[],
): SpeakerSegment {
  const text = words.map((w) => w.word).join(" ");
  const startMs = words[0]?.startMs ?? 0;
  const endMs = words[words.length - 1]?.endMs ?? startMs;

  if (segmentIndex === -1) {
    return {
      source: "unknown",
      sourceId: null,
      speakerLabel: "unknown",
      speakerDisplayName: null,
      speakerConfidence: null,
      startMs,
      endMs,
      text,
      words,
      attributionSource: "unknown",
      diarizationModel: null,
      asrModel: null,
    };
  }

  const template = segments[segmentIndex];
  return {
    ...template,
    startMs,
    endMs,
    text,
    words,
  };
}

function mergeWithProportionalSplit(segments: SpeakerSegment[], asrText: string): SpeakerSegment[] {
  const tokens = asrText.split(/(\s+)/).filter((t) => t.trim().length > 0);
  const totalDuration = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.endMs - segment.startMs),
    0,
  );

  if (totalDuration === 0 || tokens.length === 0) {
    return segments.map((segment) => ({ ...segment, text: "" }));
  }

  const result: SpeakerSegment[] = [];
  let tokenIndex = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const duration = Math.max(0, segment.endMs - segment.startMs);
    let tokenCount = Math.floor((tokens.length * duration) / totalDuration);

    // Assign remaining tokens to the last segment to avoid losing text.
    if (i === segments.length - 1) {
      tokenCount = tokens.length - tokenIndex;
    }

    const segmentTokens = tokens.slice(tokenIndex, tokenIndex + Math.max(0, tokenCount));
    tokenIndex += segmentTokens.length;

    result.push({
      ...segment,
      text: segmentTokens.join(" "),
      words: null,
    });
  }

  return result;
}

function mergeSameSpeakerGaps(segments: SpeakerSegment[], mergeGapMs: number): SpeakerSegment[] {
  if (segments.length === 0) {
    return [];
  }

  const result: SpeakerSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i += 1) {
    const current = segments[i];
    const previous = result[result.length - 1];
    const gap = current.startMs - previous.endMs;

    if (previous.speakerLabel === current.speakerLabel && gap <= mergeGapMs) {
      previous.endMs = Math.max(previous.endMs, current.endMs);
      previous.text = `${previous.text} ${current.text}`.trim();
      previous.words = joinWords(previous.words, current.words);
    } else {
      result.push(current);
    }
  }

  return result;
}

function absorbShortSegments(segments: SpeakerSegment[], minSegmentMs: number): SpeakerSegment[] {
  if (segments.length === 0) {
    return [];
  }

  let result = segments;
  let changed = true;
  while (changed) {
    changed = false;
    const next: SpeakerSegment[] = [];
    for (let i = 0; i < result.length; i += 1) {
      const current = result[i];
      const duration = current.endMs - current.startMs;
      if (duration >= minSegmentMs || next.length === 0) {
        next.push(current);
        continue;
      }

      // Prefer merging with same-speaker neighbor; otherwise with the longer neighbor.
      const previous = next[next.length - 1];
      const nextSegment = result[i + 1];
      const previousDuration = previous.endMs - previous.startMs;
      const nextDuration = nextSegment ? nextSegment.endMs - nextSegment.startMs : 0;

      if (
        nextSegment &&
        nextSegment.speakerLabel === current.speakerLabel &&
        previous.speakerLabel !== current.speakerLabel
      ) {
        nextSegment.text = `${current.text} ${nextSegment.text}`.trim();
        nextSegment.startMs = Math.min(nextSegment.startMs, current.startMs);
        nextSegment.words = joinWords(current.words, nextSegment.words);
        changed = true;
      } else if (
        previous.speakerLabel === current.speakerLabel ||
        nextDuration <= previousDuration
      ) {
        previous.text = `${previous.text} ${current.text}`.trim();
        previous.endMs = Math.max(previous.endMs, current.endMs);
        previous.words = joinWords(previous.words, current.words);
        changed = true;
      } else if (nextSegment) {
        nextSegment.text = `${current.text} ${nextSegment.text}`.trim();
        nextSegment.startMs = Math.min(nextSegment.startMs, current.startMs);
        nextSegment.words = joinWords(current.words, nextSegment.words);
        changed = true;
      } else {
        next.push(current);
      }
    }
    result = next;
  }

  return result;
}

function joinWords(
  a: SpeakerSegmentWord[] | null,
  b: SpeakerSegmentWord[] | null,
): SpeakerSegmentWord[] | null {
  if (!a && !b) {
    return null;
  }
  return [...(a ?? []), ...(b ?? [])];
}
