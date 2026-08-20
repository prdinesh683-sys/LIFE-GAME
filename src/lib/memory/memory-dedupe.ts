import { normalizeMemory, type MemoryRecord } from "../ai/records";
import { similarity } from "./memory-retrieval";

/**
 * Deterministic duplicate detection and consolidation. Identity is decided by
 * stored fields (kind + normalized text + entity), never by an AI.
 */

export interface DuplicateGroup {
  signature: string;
  keep: MemoryRecord;
  duplicates: MemoryRecord[];
}

export function findDuplicates(records: MemoryRecord[]): DuplicateGroup[] {
  const bySignature = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const memory = normalizeMemory(record);
    if (memory.status !== "active") continue;
    const rows = bySignature.get(memory.signature) ?? [];
    rows.push(memory);
    bySignature.set(memory.signature, rows);
  }

  const groups: DuplicateGroup[] = [];
  for (const [signature, rows] of bySignature) {
    if (rows.length < 2) continue;
    // Keep the oldest record so provenance points at the original observation.
    const ordered = [...rows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const keep = ordered[0] as MemoryRecord;
    groups.push({ signature, keep, duplicates: ordered.slice(1) });
  }
  return groups;
}

/** Near-duplicates for review only — never auto-merged. */
export function findNearDuplicates(records: MemoryRecord[], threshold = 0.8): [MemoryRecord, MemoryRecord][] {
  const active = records.map(normalizeMemory).filter((m) => m.status === "active");
  const pairs: [MemoryRecord, MemoryRecord][] = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i] as MemoryRecord;
      const b = active[j] as MemoryRecord;
      if (a.kind !== b.kind) continue;
      if (normalizeMemory(a).signature === normalizeMemory(b).signature) continue;
      if (similarity(a.text, b.text) >= threshold) pairs.push([a, b]);
    }
  }
  return pairs;
}

export interface ConsolidationResult {
  /** The surviving memory, carrying provenance from every folded record. */
  merged: MemoryRecord;
  /** Folded records, marked superseded — evidence is preserved, never deleted. */
  superseded: MemoryRecord[];
}

/**
 * Folds several memories that clearly say the same thing into one. Supporting
 * evidence, related entities and source ids from all originals are preserved.
 */
export function consolidate(group: DuplicateGroup, now: string = new Date().toISOString()): ConsolidationResult {
  const keep = normalizeMemory(group.keep);
  const all = [keep, ...group.duplicates.map(normalizeMemory)];

  const evidence = new Set<string>();
  const entities = new Set<string>();
  const contradictions = new Set<string>();
  for (const memory of all) {
    memory.supportingEvidenceIds.forEach((id) => evidence.add(id));
    memory.relatedEntityIds.forEach((id) => entities.add(id));
    memory.contradictions.forEach((text) => contradictions.add(text));
    if (memory.sourceId) evidence.add(memory.sourceId);
  }

  const confidences = all.map((m) => m.confidence).filter((c): c is number => typeof c === "number");

  const merged: MemoryRecord = {
    ...keep,
    updatedAt: now,
    version: keep.version + 1,
    previousVersionId: keep.id,
    pinned: all.some((m) => m.pinned),
    confidence: confidences.length ? Math.max(...confidences) : keep.confidence,
    supportingEvidenceIds: [...evidence],
    relatedEntityIds: [...entities],
    contradictions: [...contradictions],
    consolidatedFrom: group.duplicates.map((m) => m.id),
    useCount: all.reduce((sum, m) => sum + m.useCount, 0),
  };

  const superseded = group.duplicates.map((record) => ({
    ...normalizeMemory(record),
    status: "superseded" as const,
    updatedAt: now,
    previousVersionId: keep.id,
  }));

  return { merged, superseded };
}
