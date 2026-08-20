import { memorySignature, normalizeMemory, type MemoryRecord } from "../ai/records";

/**
 * Versioning and preference evolution. A meaningful change never rewrites the
 * old statement: the previous version is closed with an effectiveTo date and
 * the new version points back at it.
 */

export interface ReviseInput {
  previous: MemoryRecord;
  /** New id for the successor record. */
  id: string;
  text: string;
  reason: string;
  confidence?: number | null;
  now?: string;
}

export interface RevisionResult {
  /** Old record, closed off but fully readable. */
  closed: MemoryRecord;
  /** New current version. */
  next: MemoryRecord;
}

/** True when the change is meaningful enough to warrant a new version. */
export function isMeaningfulChange(previous: MemoryRecord, text: string): boolean {
  const before = normalizeMemory(previous).text.trim().toLowerCase();
  const after = text.trim().toLowerCase();
  if (before === after) return false;
  // Pure whitespace/punctuation edits are not a new version.
  const strip = (value: string) => value.replace(/[^a-z0-9]+/g, "");
  return strip(before) !== strip(after);
}

export function reviseMemory(input: ReviseInput): RevisionResult {
  const now = input.now ?? new Date().toISOString();
  const previous = normalizeMemory(input.previous);

  const closed: MemoryRecord = {
    ...previous,
    status: "superseded",
    effectiveTo: now,
    updatedAt: now,
  };

  const next: MemoryRecord = {
    ...previous,
    id: input.id,
    text: input.text.trim(),
    status: "active",
    version: previous.version + 1,
    previousVersionId: previous.id,
    effectiveFrom: now,
    effectiveTo: null,
    createdAt: previous.createdAt,
    updatedAt: now,
    confidence: input.confidence === undefined ? previous.confidence : input.confidence,
    signature: memorySignature({
      kind: previous.kind,
      text: input.text,
      relatedEntityIds: previous.relatedEntityIds,
    }),
    contradictions: [...previous.contradictions, `Previously: ${previous.text} (${input.reason})`],
  };

  return { closed, next };
}

export interface PreferenceTimelineEntry {
  id: string;
  text: string;
  from: string;
  to: string | null;
  current: boolean;
  version: number;
}

/** Full history of one preference lineage, oldest first. */
export function preferenceTimeline(records: MemoryRecord[], memoryId: string): PreferenceTimelineEntry[] {
  const byId = new Map(records.map((record) => [record.id, normalizeMemory(record)]));
  const chain: MemoryRecord[] = [];

  // Walk backwards through previousVersionId, then forwards through successors.
  let cursor = byId.get(memoryId) ?? null;
  while (cursor) {
    chain.unshift(cursor);
    const prevId = cursor.previousVersionId;
    cursor = prevId ? (byId.get(prevId) ?? null) : null;
  }

  let head = chain[chain.length - 1];
  let successor = [...byId.values()].find((m) => m.previousVersionId === head?.id);
  while (head && successor) {
    chain.push(successor);
    head = successor;
    successor = [...byId.values()].find((m) => m.previousVersionId === head?.id);
  }

  return chain.map((record) => {
    const memory = normalizeMemory(record);
    return {
      id: memory.id,
      text: memory.text,
      from: memory.effectiveFrom,
      to: memory.effectiveTo ?? null,
      current: memory.status === "active" && !memory.effectiveTo,
      version: memory.version,
    };
  });
}

/** The preference that is true right now for a given lineage/topic. */
export function currentPreferences(records: MemoryRecord[]): MemoryRecord[] {
  return records
    .map(normalizeMemory)
    .filter((m) => m.kind === "USER_PREFERENCE" && m.status === "active" && !m.effectiveTo);
}

export function historicalPreferences(records: MemoryRecord[]): MemoryRecord[] {
  return records
    .map(normalizeMemory)
    .filter((m) => m.kind === "USER_PREFERENCE" && (m.status === "superseded" || !!m.effectiveTo));
}
