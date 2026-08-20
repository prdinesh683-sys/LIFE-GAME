import {
  MEMORY_KIND_LABELS,
  MEMORY_SOURCE_LABELS,
  memorySignature,
  normalizeMemory,
  type MemoryKind,
  type MemoryRecord,
  type MemorySourceType,
  type NormalizedMemory,
} from "../ai/records";

/**
 * Provenance — every persistent memory must be able to answer
 * "why do you remember this?" from deterministic, stored facts only.
 */

export interface MemoryProvenance {
  sourceType: MemorySourceType;
  sourceLabel: string;
  sourceId: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  confidence: number | null;
  supportingEvidenceIds: string[];
  relatedEntityIds: string[];
  version: number;
  status: string;
  trusted: boolean;
}

/** Explicit user memories and approved decisions carry the highest trust. */
export function isTrusted(record: MemoryRecord): boolean {
  const memory = normalizeMemory(record);
  return (
    memory.sourceType === "USER" ||
    memory.sourceType === "APPROVED_DECISION" ||
    memory.kind === "USER_PREFERENCE" ||
    memory.kind === "APPROVED_DECISION" ||
    memory.pinned
  );
}

export function provenanceOf(record: MemoryRecord): MemoryProvenance {
  const memory = normalizeMemory(record);
  return {
    sourceType: memory.sourceType,
    sourceLabel: MEMORY_SOURCE_LABELS[memory.sourceType],
    sourceId: memory.sourceId ?? null,
    deviceId: memory.deviceId ?? null,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    confidence: memory.confidence,
    supportingEvidenceIds: memory.supportingEvidenceIds,
    relatedEntityIds: memory.relatedEntityIds,
    version: memory.version,
    status: memory.status,
    trusted: isTrusted(memory),
  };
}

/** Plain-language answer shown under "Why do you remember this?". */
export function explainProvenance(record: MemoryRecord): string {
  const p = provenanceOf(record);
  const parts = [`${MEMORY_KIND_LABELS[record.kind]} · ${p.sourceLabel}`];
  parts.push(`Saved ${new Date(p.createdAt).toLocaleDateString()}`);
  if (p.version > 1) parts.push(`version ${p.version}`);
  if (p.supportingEvidenceIds.length) {
    parts.push(`${p.supportingEvidenceIds.length} supporting record${p.supportingEvidenceIds.length === 1 ? "" : "s"}`);
  }
  if (typeof p.confidence === "number") parts.push(`confidence ${Math.round(p.confidence * 100)}%`);
  if (p.status !== "active") parts.push(p.status);
  if (record.kind === "AI_HYPOTHESIS") parts.push("still a hypothesis — not treated as fact");
  return `${parts.join(" · ")}.`;
}

export interface MemoryDraft {
  kind: MemoryKind;
  text: string;
  sourceType: MemorySourceType;
  sourceId?: string | null;
  deviceId?: string | null;
  confidence?: number | null;
  supportingEvidenceIds?: string[];
  relatedEntityIds?: string[];
  pinned?: boolean;
  effectiveFrom?: string;
  now?: string;
}

/** Builds a fully-provenanced memory record. The only sanctioned creation path. */
export function buildMemory(id: string, draft: MemoryDraft): NormalizedMemory {
  const iso = draft.now ?? new Date().toISOString();
  const source: MemoryRecord["source"] =
    draft.sourceType === "USER" ? "user" : draft.sourceType === "AI_HYPOTHESIS" ? "ai" : "engine";
  return normalizeMemory({
    id,
    kind: draft.kind,
    text: draft.text.trim(),
    source,
    confidence: draft.confidence ?? null,
    createdAt: iso,
    updatedAt: iso,
    pinned: draft.pinned ?? (draft.kind === "USER_PREFERENCE" || draft.kind === "APPROVED_DECISION"),
    sourceType: draft.sourceType,
    sourceId: draft.sourceId ?? null,
    deviceId: draft.deviceId ?? null,
    status: "active",
    version: 1,
    previousVersionId: null,
    effectiveFrom: draft.effectiveFrom ?? iso,
    effectiveTo: null,
    supportingEvidenceIds: draft.supportingEvidenceIds ?? [],
    relatedEntityIds: draft.relatedEntityIds ?? [],
    useCount: 0,
    signature: memorySignature({
      kind: draft.kind,
      text: draft.text,
      relatedEntityIds: draft.relatedEntityIds ?? [],
    }),

    contradictions: [],
  });
}
