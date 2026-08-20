/**
 * Phase 3 sync layer types.
 *
 * The live database stays local. Everything here describes how local state is
 * mirrored to the user's own Google Drive vault: append-only events, conflicts
 * that a human must resolve, and backup/export artifacts.
 */

/**
 * Sync payload/schema version — deliberately SEPARATE from the IndexedDB
 * database version (`DB_VERSION` in data/indexeddb-repository.ts).
 *
 * They answer different questions and move at different speeds:
 *  - DB_VERSION describes the *local* object stores and indexes on this device.
 *    Adding a store (a new phase) bumps it, and no other device is affected.
 *  - SYNC_SCHEMA_VERSION describes the *wire* shape of an uploaded event or
 *    backup file, which older devices must still be able to read. It only bumps
 *    when that shape changes incompatibly.
 *
 * Merging them would force every local schema addition to invalidate other
 * devices' vaults, and would hide a genuine wire break behind a routine local
 * migration. Adding a new syncable store reuses the existing payload envelope
 * ({ store, id, record }) and therefore does NOT bump this. Changing the
 * envelope itself DOES — see sync/__tests__/sync-schema-version.test.ts.
 */
export const SYNC_SCHEMA_VERSION = 1;

/** Append-only device event. Never rewritten once created. */
export interface SyncEvent {
  /** Stable id — the deduplication key. */
  id: string;
  event_id: string;
  device_id: string;
  timestamp: string;
  event_type: string;
  schema_version: number;
  payload: Record<string, unknown>;
  parent_version?: number;
  client_version?: string;
  /** Local bookkeeping (never uploaded). */
  status: "pending" | "uploaded" | "failed";
  attempts: number;
  lastError?: string | null;
  remoteFileId?: string | null;
}

/** The uploaded shape — local bookkeeping fields are stripped. */
export interface SyncEventPayloadFile {
  event_id: string;
  device_id: string;
  timestamp: string;
  event_type: string;
  schema_version: number;
  payload: Record<string, unknown>;
  parent_version?: number;
  client_version?: string;
}

export interface ProcessedEvent {
  /** event_id — the index key. */
  id: string;
  device_id: string;
  processedAt: string;
  outcome: "applied" | "duplicate" | "rejected" | "conflict";
  detail?: string | null;
}

export type SyncStatus =
  | "offline"
  | "not_connected"
  | "syncing"
  | "up_to_date"
  | "pending"
  | "error"
  | "conflict";

export interface SyncStateRecord {
  /** Singleton id: "sync". */
  id: "sync";
  deviceId: string;
  deviceLabel: string;
  status: SyncStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastBackupAt: string | null;
  lastWeeklyBackupAt: string | null;
  lastSnapshotAt: string | null;
  connected: boolean;
  account: string | null;
  rootFolderName: string;
  rootFolderId: string | null;
  folderIds: Record<string, string>;
  autoSync: boolean;
  autoBackup: boolean;
  driveContextEnabled: boolean;
  mcpEndpoint: string;
  /** The MCP token is deliberately NOT part of this record: it is never written to the local database. */
  mcpStatus: "not_configured" | "configured" | "unavailable";
  mcpDetail: string | null;
  uploadedEventCount: number;
  appliedEventCount: number;
}

export type ConflictResolution = "keep_local" | "keep_remote" | "merge" | "review_later";

export interface ConflictRecord {
  id: string;
  detectedAt: string;
  entityStore: string;
  entityId: string;
  entityLabel: string;
  field: string | null;
  localDeviceId: string;
  remoteDeviceId: string;
  localValue: unknown;
  remoteValue: unknown;
  eventId: string;
  status: "open" | "resolved";
  resolution: ConflictResolution | null;
  resolvedAt: string | null;
}

export interface BackupMetaRecord {
  id: string;
  createdAt: string;
  type: "daily" | "weekly" | "manual" | "safety";
  deviceId: string;
  fileName: string;
  driveFileId: string | null;
  sizeBytes: number;
  recordCount: number;
  schemaVersion: number;
  checksum: string;
  verified: boolean;
}

export interface DriveFileRecord {
  /** Drive file id. */
  id: string;
  name: string;
  folder: string;
  kind: "event" | "backup" | "export" | "snapshot" | "memory" | "manifest" | "other";
  modifiedTime: string | null;
  sizeBytes: number | null;
  syncedAt: string;
}

export interface VaultManifest {
  appVersion: string;
  schemaVersion: number;
  vaultVersion: number;
  backupVersion: number;
  devices: { device_id: string; label: string; lastSeen: string }[];
  syncState: {
    lastSyncAt: string | null;
    lastBackupAt: string | null;
    uploadedEventCount: number;
    appliedEventCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BackupFile {
  kind: "life-game-backup";
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  deviceId: string;
  recordCount: number;
  checksum: string;
  manifest: VaultManifest;
  data: Record<string, unknown[]>;
}

export interface ExportFile {
  kind: "life-game-export";
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  deviceId: string;
  recordCount: number;
  manifest: VaultManifest;
  data: Record<string, unknown[]>;
}
