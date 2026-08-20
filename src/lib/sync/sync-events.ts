import { SYNC_SCHEMA_VERSION, type SyncEvent, type SyncEventPayloadFile } from "./types";

export const APP_VERSION = "3.0.0";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-browser device identity. */
export function resolveDeviceId(read: () => string | null, write: (value: string) => void): string {
  const existing = read();
  if (existing) return existing;
  const created = `device-${randomId()}`;
  write(created);
  return created;
}

export interface CreateEventInput {
  deviceId: string;
  eventType: string;
  payload: Record<string, unknown>;
  parentVersion?: number;
  timestamp?: string;
  eventId?: string;
}

export function createSyncEvent(input: CreateEventInput): SyncEvent {
  const eventId = input.eventId ?? randomId();
  return {
    id: eventId,
    event_id: eventId,
    device_id: input.deviceId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    event_type: input.eventType,
    schema_version: SYNC_SCHEMA_VERSION,
    payload: input.payload,
    ...(input.parentVersion !== undefined ? { parent_version: input.parentVersion } : {}),
    client_version: APP_VERSION,
    status: "pending",
    attempts: 0,
    lastError: null,
    remoteFileId: null,
  };
}

/** Strips local bookkeeping before upload — uploaded events are immutable. */
export function toUploadPayload(event: SyncEvent): SyncEventPayloadFile {
  return {
    event_id: event.event_id,
    device_id: event.device_id,
    timestamp: event.timestamp,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    ...(event.parent_version !== undefined ? { parent_version: event.parent_version } : {}),
    ...(event.client_version ? { client_version: event.client_version } : {}),
  };
}

export type ValidationResult =
  | { ok: true; event: SyncEventPayloadFile }
  | { ok: false; reason: string };

/** Rejects malformed or future-schema events instead of guessing. */
export function validateRemoteEvent(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const record = raw as Record<string, unknown>;
  for (const field of ["event_id", "device_id", "timestamp", "event_type"]) {
    if (typeof record[field] !== "string" || !record[field]) {
      return { ok: false, reason: `missing ${field}` };
    }
  }
  const schemaVersion = record["schema_version"];
  if (typeof schemaVersion !== "number") return { ok: false, reason: "missing schema_version" };
  if (schemaVersion > SYNC_SCHEMA_VERSION) {
    return { ok: false, reason: `schema ${schemaVersion} is newer than this app understands` };
  }
  const payload = record["payload"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "payload must be an object" };
  }
  return {
    ok: true,
    event: {
      event_id: record["event_id"] as string,
      device_id: record["device_id"] as string,
      timestamp: record["timestamp"] as string,
      event_type: record["event_type"] as string,
      schema_version: schemaVersion,
      payload: payload as Record<string, unknown>,
      ...(typeof record["parent_version"] === "number"
        ? { parent_version: record["parent_version"] }
        : {}),
      ...(typeof record["client_version"] === "string"
        ? { client_version: record["client_version"] }
        : {}),
    },
  };
}

export function sortEventsByTime<T extends { timestamp: string; event_id: string }>(events: T[]): T[] {
  return [...events].sort((a, b) =>
    a.timestamp === b.timestamp
      ? a.event_id.localeCompare(b.event_id)
      : a.timestamp.localeCompare(b.timestamp),
  );
}
