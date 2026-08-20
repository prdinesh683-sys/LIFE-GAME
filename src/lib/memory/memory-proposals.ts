import { memoryProposalSchema, type MemoryProposalResponse } from "../ai/schemas";
import type { MemoryKind, MemoryRecord } from "../ai/records";
import { buildMemory, type MemoryDraft } from "./memory-provenance";

/**
 * AI memory proposals. The AI may suggest memories; it can never write, promote
 * or delete one. Malformed output is rejected outright, and every accepted
 * proposal enters as a hypothesis unless it carries real evidence.
 */

export interface ProposalReview {
  accepted: MemoryDraft[];
  rejected: { text: string; reason: string }[];
}

/** Evidence required before a proposal may enter as anything stronger than a hypothesis. */
export const FACT_EVIDENCE_THRESHOLD = 2;

export function parseMemoryProposals(raw: unknown): MemoryProposalResponse | null {
  // A reply that does not even carry a memories array is malformed, not empty.
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { memories?: unknown }).memories)) {
    return null;
  }
  const result = memoryProposalSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function reviewProposals(
  raw: unknown,
  options: { deviceId?: string | null; knownEvidenceIds?: string[] } = {},
): ProposalReview {
  const parsed = parseMemoryProposals(raw);
  if (!parsed) return { accepted: [], rejected: [{ text: "", reason: "malformed AI output" }] };

  const known = options.knownEvidenceIds ? new Set(options.knownEvidenceIds) : null;
  const accepted: MemoryDraft[] = [];
  const rejected: ProposalReview["rejected"] = [];

  for (const candidate of parsed.memories) {
    const text = candidate.text.trim();
    if (!text) {
      rejected.push({ text, reason: "empty text" });
      continue;
    }
    // Evidence ids must be real records this device knows about.
    const evidence = known
      ? candidate.supporting_evidence_ids.filter((id) => known.has(id))
      : candidate.supporting_evidence_ids;

    let kind: MemoryKind = candidate.kind;
    if (kind !== "AI_HYPOTHESIS" && evidence.length < FACT_EVIDENCE_THRESHOLD) {
      // Not enough evidence to promote: it stays a hypothesis, never a fact.
      kind = "AI_HYPOTHESIS";
    }

    accepted.push({
      kind,
      text,
      sourceType: kind === "AI_HYPOTHESIS" ? "AI_HYPOTHESIS" : "OBSERVED_PATTERN",
      deviceId: options.deviceId ?? null,
      confidence: candidate.confidence,
      supportingEvidenceIds: evidence,
      relatedEntityIds: candidate.related_entity_ids,
      pinned: false,
    });
  }

  return { accepted, rejected };
}

export function draftsToRecords(
  drafts: MemoryDraft[],
  makeId: (prefix: string) => string,
): MemoryRecord[] {
  return drafts.map((draft) => buildMemory(makeId("mem"), draft));
}

/** An AI may only ever suggest removal — deletion always requires the user. */
export interface DeletionSuggestion {
  memoryId: string;
  reason: string;
  suggestedAt: string;
  requiresUserApproval: true;
}

export function suggestDeletion(memoryId: string, reason: string): DeletionSuggestion {
  return {
    memoryId,
    reason,
    suggestedAt: new Date().toISOString(),
    requiresUserApproval: true,
  };
}
