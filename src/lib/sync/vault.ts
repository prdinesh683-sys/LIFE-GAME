import type { DriveProvider } from "./providers/drive-provider";

export const VAULT_ROOT = "Personal Life Game";

export const VAULT_FOLDERS = {
  events: "events",
  processed: "processed",
  backups: "backups",
  exports: "exports",
  snapshots: "snapshots",
  memory: "memory",
} as const;

export type VaultFolder = keyof typeof VAULT_FOLDERS;

export interface VaultLayout {
  rootId: string;
  folderIds: Record<string, string>;
}

/** Creates the vault folder tree if missing. Safe to call repeatedly. */
export async function ensureVault(
  provider: DriveProvider,
  rootName: string = VAULT_ROOT,
): Promise<VaultLayout> {
  const rootId = await provider.ensureFolder(rootName, null);
  const folderIds: Record<string, string> = {};
  for (const folder of Object.values(VAULT_FOLDERS)) {
    folderIds[folder] = await provider.ensureFolder(folder, rootId);
  }
  return { rootId, folderIds };
}

export function eventFileName(timestamp: string, eventId: string): string {
  return `${timestamp.replace(/[:.]/g, "-")}__${eventId}.json`;
}

export function eventIdFromFileName(name: string): string | null {
  const match = /__([^_]+)\.json$/.exec(name);
  return match?.[1] ?? null;
}

export function backupFileName(type: string, createdAt: string): string {
  return `backup-${type}-${createdAt.replace(/[:.]/g, "-")}.json`;
}

export function exportFileName(createdAt: string): string {
  return `export-${createdAt.replace(/[:.]/g, "-")}.json`;
}
