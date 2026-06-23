// Speaker mapping layer: manual display names and contextual proposals for D4.
// No biometric identification; proposals require explicit confirmation.
import {
  deleteSpeakerMapping,
  getSpeakerMapping,
  getSpeakerMappingsByAgent,
  setSpeakerMapping,
  type SpeakerMappingRow,
} from "./db.js";
import type { SpeakerSegment } from "./types.js";

export type SpeakerMapping = SpeakerMappingRow;

export type SpeakerProposalInput = {
  agentId: string;
  speakerLabel: string;
  displayName: string;
  confidence: number;
  contextHint?: string | null;
};

export type ApplyMappingsOptions = {
  /** Only confirmed mappings are applied; pending proposals are ignored. */
  confirmedOnly?: boolean;
};

/**
 * Resolve the display name for a single speaker label.
 * Returns null if no mapping exists or if the mapping is not confirmed
 * and confirmedOnly is true.
 */
export async function resolveSpeakerDisplayName(
  agentId: string,
  speakerLabel: string,
  options: { confirmedOnly?: boolean } = {},
): Promise<string | null> {
  const mapping = await getSpeakerMapping(agentId, speakerLabel);
  if (!mapping) {
    return null;
  }
  if (options.confirmedOnly !== false && !mapping.confirmed) {
    return null;
  }
  return mapping.speakerDisplayName;
}

/**
 * Apply confirmed speaker mappings to a list of segments.
 * The original segments are not mutated; a new array is returned.
 */
export async function applySpeakerMappings(
  agentId: string,
  segments: SpeakerSegment[],
  options: ApplyMappingsOptions = {},
): Promise<SpeakerSegment[]> {
  const confirmedOnly = options.confirmedOnly !== false;
  const mappings = await getSpeakerMappingsByAgent(agentId, {
    confirmed: confirmedOnly ? true : undefined,
  });
  const map = new Map(mappings.map((m) => [m.speakerLabel, m.speakerDisplayName]));
  return segments.map((segment) => {
    const displayName = map.get(segment.speakerLabel);
    if (!displayName) {
      return segment;
    }
    return { ...segment, speakerDisplayName: displayName };
  });
}

/**
 * Record a manual speaker mapping. Manual mappings are immediately confirmed.
 */
export async function setManualSpeakerMapping(
  agentId: string,
  speakerLabel: string,
  displayName: string,
): Promise<void> {
  const now = Date.now();
  await setSpeakerMapping({
    agentId,
    speakerLabel,
    speakerDisplayName: displayName,
    attributionSource: "manual",
    confidence: 1.0,
    confirmed: 1,
    proposedAt: now,
    confirmedAt: now,
    contextHint: null,
  });
}

/**
 * Record a contextual proposal. Proposals are unconfirmed until the user
 * explicitly confirms them.
 */
export async function recordSpeakerProposal(input: SpeakerProposalInput): Promise<void> {
  const { agentId, speakerLabel, displayName, confidence, contextHint } = input;
  const existing = await getSpeakerMapping(agentId, speakerLabel);
  if (existing?.confirmed) {
    // Never overwrite a confirmed mapping with a proposal.
    return;
  }
  await setSpeakerMapping({
    agentId,
    speakerLabel,
    speakerDisplayName: displayName,
    attributionSource: "contextual_proposal",
    confidence,
    confirmed: 0,
    proposedAt: Date.now(),
    confirmedAt: null,
    contextHint: contextHint ?? null,
  });
}

/**
 * Confirm a pending proposal.
 */
export async function confirmSpeakerProposal(
  agentId: string,
  speakerLabel: string,
): Promise<boolean> {
  const existing = await getSpeakerMapping(agentId, speakerLabel);
  if (!existing || existing.confirmed) {
    return false;
  }
  await setSpeakerMapping({
    ...existing,
    confirmed: 1,
    confirmedAt: Date.now(),
  });
  return true;
}

/**
 * Reject (delete) a pending proposal.
 */
export async function rejectSpeakerProposal(
  agentId: string,
  speakerLabel: string,
): Promise<boolean> {
  const existing = await getSpeakerMapping(agentId, speakerLabel);
  if (!existing || existing.confirmed) {
    return false;
  }
  await deleteSpeakerMapping(agentId, speakerLabel);
  return true;
}

/**
 * List pending proposals for an agent.
 */
export async function getPendingProposals(agentId: string): Promise<SpeakerMapping[]> {
  return getSpeakerMappingsByAgent(agentId, { confirmed: false });
}

/**
 * List confirmed mappings for an agent.
 */
export async function getConfirmedMappings(agentId: string): Promise<SpeakerMapping[]> {
  return getSpeakerMappingsByAgent(agentId, { confirmed: true });
}

/**
 * Remove a speaker mapping (manual or confirmed).
 */
export async function clearSpeakerMapping(agentId: string, speakerLabel: string): Promise<void> {
  await deleteSpeakerMapping(agentId, speakerLabel);
}
