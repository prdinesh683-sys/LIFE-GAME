import { normalizeMemory, type MemoryKind, type MemoryRecord } from "../ai/records";
import { rescoreAll } from "./memory-scoring";

/**
 * Layered retrieval. The AI never queries the store: this module returns the
 * smallest useful set of memories for one request, in strict authority order.
 *
 *   deterministic state > metrics > approved preferences/decisions
 *     > validated patterns > AI hypotheses
 */

export type RetrievalLayer = "DIRECT" | "RELATED" | "PATTERNS" | "DECISIONS" | "HYPOTHESES";

export const RETRIEVAL_LAYER_ORDER: RetrievalLayer[] = [
  "DIRECT",
  "RELATED",
  "PATTERNS",
  "DECISIONS",
  "HYPOTHESES",
];

/** Authority order used everywhere memories are handed to a brain. */
export const MEMORY_PRECEDENCE: MemoryKind[] = [
  "APPROVED_DECISION",
  "USER_PREFERENCE",
  "FACT",
  "OBSERVED_PATTERN",
  "AI_HYPOTHESIS",
];

export interface RetrievalQuery {
  /** Free text of the current situation/question — used for term overlap. */
  text?: string;
  /** Ids of goals/quests/recommendations in play right now. */
  entityIds?: string[];
  /** Hard ceiling. Retrieval stops earlier when context is already sufficient. */
  limit?: number;
  /** Score at/above which a memory counts toward "sufficient context". */
  sufficientScore?: number;
  /** How many good memories are enough to stop descending layers. */
  sufficientCount?: number;
  includeArchived?: boolean;
  now?: number;
}

export interface RetrievedMemory {
  memory: MemoryRecord;
  layer: RetrievalLayer;
  score: number;
  reason: string;
}

export interface RetrievalResult {
  memories: RetrievedMemory[];
  layersUsed: RetrievalLayer[];
  /** Total candidates considered — proves the full store is never returned. */
  considered: number;
  stoppedEarly: boolean;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "my", "me", "i", "you", "it", "that", "this",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** Deterministic lexical overlap — no embeddings required, no extra provider. */
export function similarity(query: string, text: string): number {
  const a = new Set(terms(query));
  const b = new Set(terms(text));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.sqrt(a.size * b.size);
}

function layerFor(kind: MemoryKind, matched: boolean): RetrievalLayer {
  if (kind === "AI_HYPOTHESIS") return "HYPOTHESES";
  if (kind === "APPROVED_DECISION") return "DECISIONS";
  if (kind === "OBSERVED_PATTERN") return "PATTERNS";
  return matched ? "DIRECT" : "RELATED";
}

export function retrieveMemories(
  records: MemoryRecord[],
  query: RetrievalQuery = {},
): RetrievalResult {
  const limit = query.limit ?? 8;
  const sufficientScore = query.sufficientScore ?? 45;
  const sufficientCount = query.sufficientCount ?? Math.min(5, limit);
  const entityIds = new Set(query.entityIds ?? []);
  const text = query.text ?? "";

  const active = records.filter((record) => {
    const memory = normalizeMemory(record);
    if (memory.effectiveTo) return false;
    if (memory.status === "superseded") return false;
    return query.includeArchived ? true : memory.status === "active";
  });
  const scored = rescoreAll(active, query.now);

  const candidates: RetrievedMemory[] = scored.map((record) => {
    const memory = normalizeMemory(record);
    const overlap = text ? similarity(text, memory.text) : 0;
    const entityHit = memory.relatedEntityIds.some((id) => entityIds.has(id));
    const matched = entityHit || overlap >= 0.2;
    const relevance =
      (memory.importanceScore ?? 0) + Math.round(overlap * 25) + (entityHit ? 20 : 0);
    return {
      memory,
      layer: layerFor(memory.kind, matched),
      score: relevance,
      reason: entityHit
        ? "mentions something in play right now"
        : overlap >= 0.2
          ? "matches what you asked about"
          : "high-importance background",
    };
  });

  const picked: RetrievedMemory[] = [];
  const layersUsed: RetrievalLayer[] = [];
  let stoppedEarly = false;

  for (const layer of RETRIEVAL_LAYER_ORDER) {
    const strong = picked.filter((item) => item.score >= sufficientScore).length;
    if (picked.length >= limit || strong >= sufficientCount) {
      stoppedEarly = true;
      break;
    }
    const inLayer = candidates
      .filter((item) => item.layer === layer)
      .sort(
        (a, b) =>
          b.score - a.score ||
          MEMORY_PRECEDENCE.indexOf(a.memory.kind) - MEMORY_PRECEDENCE.indexOf(b.memory.kind),
      );
    if (!inLayer.length) continue;
    layersUsed.push(layer);
    for (const item of inLayer) {
      if (picked.length >= limit) break;
      picked.push(item);
    }
  }

  picked.sort(
    (a, b) =>
      MEMORY_PRECEDENCE.indexOf(a.memory.kind) - MEMORY_PRECEDENCE.indexOf(b.memory.kind) ||
      b.score - a.score,
  );

  return { memories: picked, layersUsed, considered: candidates.length, stoppedEarly };
}

export interface MemoryContextPackage {
  /** Ordered by authority; hypotheses always explicitly labelled. */
  lines: { kind: MemoryKind; text: string; label: string; hypothesis: boolean }[];
  layersUsed: RetrievalLayer[];
  considered: number;
  returned: number;
}

/** The bounded package a brain receives. Never the database. */
export function buildMemoryContext(
  records: MemoryRecord[],
  query: RetrievalQuery = {},
): MemoryContextPackage {
  const result = retrieveMemories(records, query);
  return {
    lines: result.memories.map((item) => ({
      kind: item.memory.kind,
      text: item.memory.text,
      label: item.reason,
      hypothesis: item.memory.kind === "AI_HYPOTHESIS",
    })),
    layersUsed: result.layersUsed,
    considered: result.considered,
    returned: result.memories.length,
  };
}

/** Marks retrieved memories as used, feeding the deterministic usefulness factor. */
export function markUsed(records: MemoryRecord[], usedIds: string[]): MemoryRecord[] {
  const used = new Set(usedIds);
  return records
    .filter((record) => used.has(record.id))
    .map((record) => {
      const memory = normalizeMemory(record);
      return { ...memory, useCount: memory.useCount + 1 };
    });
}
