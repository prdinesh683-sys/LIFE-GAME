import type { DriveProvider } from "./providers/drive-provider";
import { DriveError } from "./providers/drive-provider";
import { APP_VERSION } from "./sync-events";
import { SYNC_SCHEMA_VERSION, type BackupFile, type BackupMetaRecord, type ExportFile, type VaultManifest } from "./types";
import { backupFileName, exportFileName, type VaultLayout } from "./vault";

/** Small deterministic checksum — enough to detect truncated/corrupt payloads. */
export function checksum(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = (h1 ^ code) * 16777619 >>> 0;
    h2 = (h2 + code * (i + 1)) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

export function countRecords(data: Record<string, unknown[]>): number {
  return Object.values(data).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0);
}

export function buildManifest(input: {
  deviceId: string;
  deviceLabel: string;
  previous?: VaultManifest | null;
  lastSyncAt: string | null;
  lastBackupAt: string | null;
  uploadedEventCount: number;
  appliedEventCount: number;
}): VaultManifest {
  const now = new Date().toISOString();
  const devices = [...(input.previous?.devices ?? [])].filter(
    (device) => device.device_id !== input.deviceId,
  );
  devices.push({ device_id: input.deviceId, label: input.deviceLabel, lastSeen: now });
  return {
    appVersion: APP_VERSION,
    schemaVersion: SYNC_SCHEMA_VERSION,
    vaultVersion: (input.previous?.vaultVersion ?? 0) + 1,
    backupVersion: input.previous?.backupVersion ?? 0,
    devices,
    syncState: {
      lastSyncAt: input.lastSyncAt,
      lastBackupAt: input.lastBackupAt,
      uploadedEventCount: input.uploadedEventCount,
      appliedEventCount: input.appliedEventCount,
    },
    createdAt: input.previous?.createdAt ?? now,
    updatedAt: now,
  };
}

export function buildBackupFile(input: {
  data: Record<string, unknown[]>;
  deviceId: string;
  manifest: VaultManifest;
  createdAt?: string;
}): BackupFile {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    kind: "life-game-backup",
    schemaVersion: SYNC_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt,
    deviceId: input.deviceId,
    recordCount: countRecords(input.data),
    checksum: checksum(input.data),
    manifest: input.manifest,
    data: input.data,
  };
}

export function buildExportFile(input: {
  data: Record<string, unknown[]>;
  deviceId: string;
  manifest: VaultManifest;
}): ExportFile {
  return {
    kind: "life-game-export",
    schemaVersion: SYNC_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    deviceId: input.deviceId,
    recordCount: countRecords(input.data),
    manifest: input.manifest,
    data: input.data,
  };
}

export type RestoreCheck =
  | { ok: true; file: BackupFile; recordCount: number }
  | { ok: false; reason: string };

/** Never restore a file we cannot fully understand. */
export function verifyBackupFile(raw: unknown): RestoreCheck {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "Backup file is not an object." };
  const record = raw as Record<string, unknown>;
  if (record["kind"] !== "life-game-backup" && record["kind"] !== "life-game-export") {
    return { ok: false, reason: "This file is not a Personal Life Game backup." };
  }
  const schemaVersion = record["schemaVersion"];
  if (typeof schemaVersion !== "number") return { ok: false, reason: "Backup has no schema version." };
  if (schemaVersion > SYNC_SCHEMA_VERSION) {
    return { ok: false, reason: `Backup schema ${schemaVersion} is newer than this app understands.` };
  }
  const data = record["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "Backup contains no data section." };
  }
  const typedData = data as Record<string, unknown[]>;
  const expected = record["checksum"];
  if (typeof expected === "string" && expected !== checksum(typedData)) {
    return { ok: false, reason: "Backup checksum does not match its contents (file may be corrupt)." };
  }
  return { ok: true, file: raw as BackupFile, recordCount: countRecords(typedData) };
}

export async function uploadBackup(
  provider: DriveProvider,
  layout: VaultLayout,
  file: BackupFile,
  type: BackupMetaRecord["type"],
  id: string,
): Promise<BackupMetaRecord> {
  const folderId = layout.folderIds["backups"];
  if (!folderId) throw new DriveError("invalid", "Vault backups folder is missing");
  const name = backupFileName(type, file.createdAt);
  const uploaded = await provider.uploadJson(folderId, name, file);
  // Read back to prove the artifact exists and parses.
  const verifyRaw = await provider.downloadJson(uploaded.id);
  const verified = verifyBackupFile(verifyRaw);
  return {
    id,
    createdAt: file.createdAt,
    type,
    deviceId: file.deviceId,
    fileName: name,
    driveFileId: uploaded.id,
    sizeBytes: uploaded.sizeBytes ?? JSON.stringify(file).length,
    recordCount: file.recordCount,
    schemaVersion: file.schemaVersion,
    checksum: file.checksum,
    verified: verified.ok,
  };
}

export async function uploadExport(
  provider: DriveProvider,
  layout: VaultLayout,
  file: ExportFile,
): Promise<{ id: string; name: string }> {
  const folderId = layout.folderIds["exports"];
  if (!folderId) throw new DriveError("invalid", "Vault exports folder is missing");
  const name = exportFileName(file.createdAt);
  const uploaded = await provider.uploadJson(folderId, name, file);
  return { id: uploaded.id, name };
}

export interface BackupSchedule {
  lastDailyAt: string | null;
  lastWeeklyAt: string | null;
  now: Date;
}

/** Gentle automation: at most one daily and one weekly backup. */
export function dueBackups(schedule: BackupSchedule): BackupMetaRecord["type"][] {
  const due: BackupMetaRecord["type"][] = [];
  const now = schedule.now.getTime();
  const day = 24 * 60 * 60 * 1000;
  const daily = schedule.lastDailyAt ? new Date(schedule.lastDailyAt).getTime() : 0;
  const weekly = schedule.lastWeeklyAt ? new Date(schedule.lastWeeklyAt).getTime() : 0;
  if (now - daily >= day) due.push("daily");
  if (now - weekly >= 7 * day) due.push("weekly");
  return due;
}
