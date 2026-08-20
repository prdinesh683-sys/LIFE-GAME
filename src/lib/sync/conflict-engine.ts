import type { ConflictRecord, SyncEventPayloadFile } from "./types";

export interface VersionedRecord {
  id: string;
  updatedAt?: string;
  version?: number;
  [key: string]: unknown;
}

export type ConflictDecision =
  | { kind: "apply" }
  | { kind: "duplicate" }
  | { kind: "stale" }
  | { kind: "conflict"; field: string | null; localValue: unknown; remoteValue: unknown };

export interface ConflictInput {
  event: SyncEventPayloadFile;
  local: VersionedRecord | null;
  /** Last time this device successfully synced. */
  lastSyncAt: string | null;
  alreadyProcessed: boolean;
}

/**
 * Deterministic conflict rules:
 * - already-processed event ids are duplicates (idempotent replay).
 * - no local record → apply.
 * - local untouched since last sync → apply (remote is newer knowledge).
 * - local changed since last sync AND values differ → human conflict.
 * - remote older than local and identical → stale, ignore.
 */
export function decideEvent(input: ConflictInput): ConflictDecision {
  if (input.alreadyProcessed) return { kind: "duplicate" };
  const local = input.local;
  if (!local) return { kind: "apply" };

  const remote = input.event.payload["record"];
  const localTouched =
    typeof local.updatedAt === "string" &&
    (!input.lastSyncAt || local.updatedAt > input.lastSyncAt);

  if (!localTouched) return { kind: "apply" };

  const field = firstDivergentField(local, remote);
  if (!field) return { kind: "stale" };

  return {
    kind: "conflict",
    field,
    localValue: (local as Record<string, unknown>)[field],
    remoteValue:
      remote && typeof remote === "object"
        ? (remote as Record<string, unknown>)[field]
        : remote,
  };
}

export function firstDivergentField(local: VersionedRecord, remote: unknown): string | null {
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return null;
  const remoteRecord = remote as Record<string, unknown>;
  const keys = new Set([...Object.keys(local), ...Object.keys(remoteRecord)]);
  for (const key of keys) {
    if (key === "updatedAt" || key === "version" || key === "id") continue;
    if (JSON.stringify(local[key]) !== JSON.stringify(remoteRecord[key])) return key;
  }
  return null;
}

export function buildConflict(params: {
  id: string;
  event: SyncEventPayloadFile;
  localDeviceId: string;
  entityStore: string;
  entityId: string;
  entityLabel: string;
  field: string | null;
  localValue: unknown;
  remoteValue: unknown;
}): ConflictRecord {
  return {
    id: params.id,
    detectedAt: new Date().toISOString(),
    entityStore: params.entityStore,
    entityId: params.entityId,
    entityLabel: params.entityLabel,
    field: params.field,
    localDeviceId: params.localDeviceId,
    remoteDeviceId: params.event.device_id,
    localValue: params.localValue,
    remoteValue: params.remoteValue,
    eventId: params.event.event_id,
    status: "open",
    resolution: null,
    resolvedAt: null,
  };
}

/** Field-level merge: remote fills only fields the local record left empty. */
export function mergeRecords(
  local: VersionedRecord,
  remote: unknown,
): VersionedRecord {
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return local;
  const merged: VersionedRecord = { ...local };
  for (const [key, value] of Object.entries(remote as Record<string, unknown>)) {
    const current = merged[key];
    const empty =
      current === undefined ||
      current === null ||
      current === "" ||
      (Array.isArray(current) && current.length === 0);
    if (empty && value !== undefined) merged[key] = value;
  }
  merged.updatedAt = new Date().toISOString();
  return merged;
}
