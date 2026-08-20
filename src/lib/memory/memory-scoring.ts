import { normalizeMemory, type MemoryKind, type MemoryRecord } from "../ai/records";
import { isTrusted } from "./memory-provenance";

/**
 * Deterministic importance scoring. Pure arithmetic over stored fields — an AI
 * may explain a score but can never produce one.
 */

export interface ScoreInput {
  memory: MemoryRecord;
  /** How many other memories share this signature/topic. */
  recurrence?: number;
  /** Number of approved decisions this memory contributed to. */
  decisionImpact?: number;
  now?: number;
}

export interface ScoreBreakdown {
  relevance: number;
  recurrence: number;
  recency: number;
  decisionImpact: number;
  userConfirmation: number;
  confidence: number;
  usefulness: number;
  total: number;
}

const KIND_RELEVANCE: Record<MemoryKind, number> = {
  APPROVED_DECISION: 20,
  USER_PREFERENCE: 18,
  FACT: 14,
  OBSERVED_PATTERN: 12,
  AI_HYPOTHESIS: 5,
};

const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));

export function scoreMemory(input: ScoreInput): ScoreBreakdown {
  const memory = normalizeMemory(input.memory);
  const now = input.now ?? Date.now();
  const ageDays = Math.max(0, (now - Date.parse(memory.createdAt)) / 86_400_000);

  const relevance = KIND_RELEVANCE[memory.kind];
  const recurrence = clamp((input.recurrence ?? 1) * 4, 16);
  // Recency decays but never reaches zero: old-but-important memories survive.
  const recency = clamp(Math.round(16 * Math.exp(-ageDays / 45)), 16);
  const decisionImpact = clamp((input.decisionImpact ?? memory.supportingEvidenceIds.length) * 5, 15);
  const userConfirmation = isTrusted(memory) ? 15 : 0;
  const confidence = clamp(Math.round((memory.confidence ?? 0.4) * 10), 10);
  const usefulness = clamp(memory.useCount * 2, 8);

  const total = clamp(
    Math.round(
      relevance + recurrence + recency + decisionImpact + userConfirmation + confidence + usefulness,
    ),
    100,
  );

  return {
    relevance,
    recurrence,
    recency,
    decisionImpact,
    userConfirmation,
    confidence,
    usefulness,
    total,
  };
}

/** Recomputes importanceScore for a set of memories, using shared-signature recurrence. */
export function rescoreAll(records: MemoryRecord[], now?: number): MemoryRecord[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const sig = normalizeMemory(record).signature;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  return records.map((record) => {
    const memory = normalizeMemory(record);
    const breakdown = scoreMemory({
      memory,
      recurrence: counts.get(memory.signature) ?? 1,
      ...(now === undefined ? {} : { now }),
    });
    return { ...memory, importanceScore: breakdown.total };
  });
}

export function explainScore(breakdown: ScoreBreakdown): string {
  return [
    `relevance ${breakdown.relevance}`,
    `recurrence ${breakdown.recurrence}`,
    `recency ${breakdown.recency}`,
    `decision impact ${breakdown.decisionImpact}`,
    `your confirmation ${breakdown.userConfirmation}`,
    `confidence ${breakdown.confidence}`,
    `reuse ${breakdown.usefulness}`,
  ].join(" · ");
}
