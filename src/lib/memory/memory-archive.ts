import { normalizeMemory, type MemoryRecord } from "../ai/records";
import type { DriveProvider } from "../sync/providers/drive-provider";
import { ensureVault, VAULT_FOLDERS } from "../sync/vault";
import { provenanceOf } from "./memory-provenance";

/**
 * Selective Drive archive for long-term memory. IndexedDB stays the live
 * database; Drive only ever receives memories the player explicitly selected.
 * The whole memory store is never uploaded.
 */

export const MEMORY_ARCHIVE_FOLDER = VAULT_FOLDERS.memory;

export interface MemoryArchiveFile {
  kind: "memory-archive";
  version: 1;
  createdAt: string;
  deviceId: string;
  /** Explicitly selected ids only. */
  memories: MemoryRecord[];
  provenance: Record<string, ReturnType<typeof provenanceOf>>;
}

export function memoryArchiveFileName(createdAt: string): string {
  return `memory-${createdAt.replace(/[:.]/g, "-")}.json`;
}

export function buildMemoryArchive(input: {
  memories: MemoryRecord[];
  selectedIds: string[];
  deviceId: string;
  now?: string;
}): MemoryArchiveFile {
  const selected = new Set(input.selectedIds);
  if (!selected.size) throw new Error("Select the memories to archive — nothing is uploaded automatically.");
  const rows = input.memories.map(normalizeMemory).filter((memory) => selected.has(memory.id));
  if (!rows.length) throw new Error("None of the selected memories exist locally.");

  const provenance: MemoryArchiveFile["provenance"] = {};
  for (const memory of rows) provenance[memory.id] = provenanceOf(memory);

  return {
    kind: "memory-archive",
    version: 1,
    createdAt: input.now ?? new Date().toISOString(),
    deviceId: input.deviceId,
    memories: rows,
    provenance,
  };
}

export async function uploadMemoryArchive(
  provider: DriveProvider,
  file: MemoryArchiveFile,
): Promise<{ fileId: string; name: string; count: number }> {
  const layout = await ensureVault(provider);
  const folderId = layout.folderIds[MEMORY_ARCHIVE_FOLDER];
  if (!folderId) throw new Error("The Drive memory folder is unavailable.");
  const name = memoryArchiveFileName(file.createdAt);
  const ref = await provider.uploadJson(folderId, name, file);
  return { fileId: ref.id, name: ref.name || name, count: file.memories.length };
}


/**
 * Drive content is untrusted data, never instructions. Restored rows are
 * re-validated and re-flagged as coming from Drive before touching the store.
 */
export function parseMemoryArchive(raw: unknown): MemoryRecord[] {
  if (!raw || typeof raw !== "object") return [];
  const file = raw as Partial<MemoryArchiveFile>;
  if (file.kind !== "memory-archive" || !Array.isArray(file.memories)) return [];
  return file.memories
    .filter(
      (row): row is MemoryRecord =>
        !!row && typeof row === "object" && typeof (row as MemoryRecord).id === "string" &&
        typeof (row as MemoryRecord).text === "string",
    )
    .map((row) => ({ ...normalizeMemory(row), sourceType: "DRIVE" as const }));
}
