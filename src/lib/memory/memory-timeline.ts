import { normalizeMemory, type MemoryLinkRecord, type MemoryRecord } from "../ai/records";
import type {
  RecommendationOutcomeRecord,
  RecommendationRecord,
} from "../advisor/advisor-types";

/**
 * The learning loop, rendered chronologically:
 *   event -> memory -> pattern -> decision -> outcome
 * Every entry keeps a pointer back to the record it came from.
 */

export type TimelineKind = "memory" | "pattern" | "decision" | "outcome";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string;
  sourceId: string | null;
  relatedIds: string[];
  confidence: number | null;
}

export function buildTimeline(input: {
  memories: MemoryRecord[];
  links?: MemoryLinkRecord[];
  recommendations?: RecommendationRecord[];
  outcomes?: RecommendationOutcomeRecord[];
  limit?: number;
}): TimelineEntry[] {
  const links = input.links ?? [];
  const entries: TimelineEntry[] = [];

  for (const record of input.memories) {
    const memory = normalizeMemory(record);
    if (memory.status === "superseded") continue;
    const related = links
      .filter((link) => link.memoryId === memory.id)
      .map((link) => link.targetId);
    entries.push({
      id: memory.id,
      kind:
        memory.kind === "OBSERVED_PATTERN"
          ? "pattern"
          : memory.kind === "APPROVED_DECISION"
            ? "decision"
            : "memory",
      at: memory.createdAt,
      title: memory.text,
      detail: memory.sourceType,
      sourceId: memory.sourceId ?? null,
      relatedIds: [...new Set([...related, ...memory.relatedEntityIds])],
      confidence: memory.confidence,
    });
  }

  for (const rec of input.recommendations ?? []) {
    if (rec.status !== "applied" && rec.status !== "rejected") continue;
    entries.push({
      id: `rec_${rec.id}`,
      kind: "decision",
      at: rec.decidedAt ?? rec.createdAt,
      title: rec.title,
      detail: rec.status === "applied" ? "You approved this advice." : "You declined this advice.",
      sourceId: rec.id,
      relatedIds: [],
      confidence: rec.confidence ?? null,
    });
  }

  for (const outcome of input.outcomes ?? []) {
    entries.push({
      id: `out_${outcome.id}`,
      kind: "outcome",
      at: outcome.measuredAt,
      title: outcome.note,
      detail: outcome.result,
      sourceId: outcome.recommendationId,
      relatedIds: [outcome.recommendationId],
      confidence: null,
    });
  }

  const sorted = entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return input.limit ? sorted.slice(0, input.limit) : sorted;
}
