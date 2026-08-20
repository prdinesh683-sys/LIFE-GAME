import {
  normalizeMemory,
  type MemoryEntityKind,
  type MemoryLinkRecord,
  type MemoryRecord,
  type MemoryRelation,
} from "../ai/records";

/**
 * Deterministic, queryable relationships between memories and the records they
 * came from: decisions, outcomes, goals, quests, patterns and other memories.
 */

export function buildLink(input: {
  id: string;
  memoryId: string;
  relation: MemoryRelation;
  targetKind: MemoryEntityKind;
  targetId: string;
  label: string;
  deviceId?: string | null;
  now?: string;
}): MemoryLinkRecord {
  const iso = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    memoryId: input.memoryId,
    relation: input.relation,
    targetKind: input.targetKind,
    targetId: input.targetId,
    label: input.label,
    createdAt: iso,
    updatedAt: iso,
    deviceId: input.deviceId ?? null,
  };
}

export function linksForMemory(links: MemoryLinkRecord[], memoryId: string): MemoryLinkRecord[] {
  return links.filter((link) => link.memoryId === memoryId || link.targetId === memoryId);
}

export function linksForTarget(
  links: MemoryLinkRecord[],
  targetKind: MemoryEntityKind,
  targetId: string,
): MemoryLinkRecord[] {
  return links.filter((link) => link.targetKind === targetKind && link.targetId === targetId);
}

export function memoriesForEntity(
  memories: MemoryRecord[],
  links: MemoryLinkRecord[],
  targetKind: MemoryEntityKind,
  targetId: string,
): MemoryRecord[] {
  const ids = new Set(linksForTarget(links, targetKind, targetId).map((link) => link.memoryId));
  return memories.map(normalizeMemory).filter((memory) => ids.has(memory.id));
}

export function relatedMemories(
  memories: MemoryRecord[],
  links: MemoryLinkRecord[],
  memoryId: string,
): MemoryRecord[] {
  const ids = new Set<string>();
  for (const link of linksForMemory(links, memoryId)) {
    if (link.targetKind === "memory") {
      ids.add(link.memoryId === memoryId ? link.targetId : link.memoryId);
    }
  }
  return memories.map(normalizeMemory).filter((memory) => ids.has(memory.id));
}
