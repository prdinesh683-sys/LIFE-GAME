import { decideEvent, type VersionedRecord } from "./conflict-engine";
import type { DriveProvider } from "./providers/drive-provider";
import { DriveError } from "./providers/drive-provider";
import { sortEventsByTime, toUploadPayload, validateRemoteEvent } from "./sync-events";
import type {
  ConflictRecord,
  DriveFileRecord,
  ProcessedEvent,
  SyncEvent,
  SyncEventPayloadFile,
} from "./types";
import { eventFileName, eventIdFromFileName, type VaultLayout } from "./vault";

/**
 * Storage port. The engine stays pure of IndexedDB so it can be tested with
 * an in-memory port and a FakeDriveProvider.
 */
export interface SyncPort {
  deviceId: string;
  lastSyncAt: string | null;
  pendingEvents(): Promise<SyncEvent[]>;
  markEventUploaded(eventId: string, remoteFileId: string): Promise<void>;
  markEventFailed(eventId: string, error: string): Promise<void>;
  isProcessed(eventId: string): Promise<boolean>;
  recordProcessed(record: ProcessedEvent): Promise<void>;
  /** Local record the remote event targets (null when absent). */
  localRecord(event: SyncEventPayloadFile): Promise<VersionedRecord | null>;
  applyRemote(event: SyncEventPayloadFile): Promise<void>;
  recordConflict(conflict: ConflictRecord): Promise<void>;
  recordDriveFile(record: DriveFileRecord): Promise<void>;
  describeEntity(event: SyncEventPayloadFile): { store: string; id: string; label: string };
  newId(): string;
}

export interface SyncReport {
  uploaded: number;
  skippedDuplicateUploads: number;
  downloaded: number;
  applied: number;
  duplicates: number;
  rejected: number;
  conflicts: number;
  failed: number;
  errors: string[];
}

const emptyReport = (): SyncReport => ({
  uploaded: 0,
  skippedDuplicateUploads: 0,
  downloaded: 0,
  applied: 0,
  duplicates: 0,
  rejected: 0,
  conflicts: 0,
  failed: 0,
  errors: [],
});

/** Push local pending events. Existing remote file names guarantee no duplicates. */
export async function pushEvents(
  provider: DriveProvider,
  layout: VaultLayout,
  port: SyncPort,
  report: SyncReport = emptyReport(),
): Promise<SyncReport> {
  const folderId = layout.folderIds["events"];
  if (!folderId) throw new DriveError("invalid", "Vault events folder is missing");
  const pending = sortEventsByTime(await port.pendingEvents());
  if (!pending.length) return report;

  const remote = await provider.listFiles(folderId);
  const remoteEventIds = new Set(
    remote.map((file) => eventIdFromFileName(file.name)).filter((id): id is string => Boolean(id)),
  );

  for (const event of pending) {
    if (remoteEventIds.has(event.event_id)) {
      report.skippedDuplicateUploads += 1;
      await port.markEventUploaded(event.event_id, "existing");
      continue;
    }
    try {
      const file = await provider.uploadJson(
        folderId,
        eventFileName(event.timestamp, event.event_id),
        toUploadPayload(event),
      );
      await port.markEventUploaded(event.event_id, file.id);
      await port.recordDriveFile({
        id: file.id,
        name: file.name,
        folder: "events",
        kind: "event",
        modifiedTime: file.modifiedTime,
        sizeBytes: file.sizeBytes,
        syncedAt: new Date().toISOString(),
      });
      report.uploaded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await port.markEventFailed(event.event_id, message);
      report.failed += 1;
      report.errors.push(message);
      // Auth/permission failures will not fix themselves mid-run.
      if (error instanceof DriveError && (error.kind === "auth" || error.kind === "permission")) {
        throw error;
      }
    }
  }
  return report;
}

/** Pull remote events written by other devices and apply them in time order. */
export async function pullEvents(
  provider: DriveProvider,
  layout: VaultLayout,
  port: SyncPort,
  report: SyncReport = emptyReport(),
): Promise<SyncReport> {
  const folderId = layout.folderIds["events"];
  if (!folderId) throw new DriveError("invalid", "Vault events folder is missing");
  const files = await provider.listFiles(folderId);

  const candidates: { fileId: string; eventId: string; name: string }[] = [];
  for (const file of files) {
    const eventId = eventIdFromFileName(file.name);
    if (!eventId) continue;
    if (await port.isProcessed(eventId)) {
      report.duplicates += 1;
      continue;
    }
    candidates.push({ fileId: file.id, eventId, name: file.name });
  }

  const loaded: SyncEventPayloadFile[] = [];
  for (const candidate of candidates) {
    try {
      const raw = await provider.downloadJson(candidate.fileId);
      const validated = validateRemoteEvent(raw);
      if (!validated.ok) {
        report.rejected += 1;
        await port.recordProcessed({
          id: candidate.eventId,
          device_id: "unknown",
          processedAt: new Date().toISOString(),
          outcome: "rejected",
          detail: validated.reason,
        });
        continue;
      }
      report.downloaded += 1;
      loaded.push(validated.event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failed += 1;
      report.errors.push(message);
      if (error instanceof DriveError && (error.kind === "auth" || error.kind === "permission")) {
        throw error;
      }
    }
  }

  for (const event of sortEventsByTime(loaded)) {
    if (event.device_id === port.deviceId) {
      // Our own event coming back from Drive: acknowledge, never re-apply.
      report.duplicates += 1;
      await port.recordProcessed({
        id: event.event_id,
        device_id: event.device_id,
        processedAt: new Date().toISOString(),
        outcome: "duplicate",
        detail: "originated on this device",
      });
      continue;
    }

    const local = await port.localRecord(event);
    const decision = decideEvent({
      event,
      local,
      lastSyncAt: port.lastSyncAt,
      alreadyProcessed: await port.isProcessed(event.event_id),
    });

    if (decision.kind === "duplicate" || decision.kind === "stale") {
      report.duplicates += 1;
      await port.recordProcessed({
        id: event.event_id,
        device_id: event.device_id,
        processedAt: new Date().toISOString(),
        outcome: "duplicate",
        detail: decision.kind,
      });
      continue;
    }

    if (decision.kind === "conflict") {
      const entity = port.describeEntity(event);
      report.conflicts += 1;
      await port.recordConflict({
        id: port.newId(),
        detectedAt: new Date().toISOString(),
        entityStore: entity.store,
        entityId: entity.id,
        entityLabel: entity.label,
        field: decision.field,
        localDeviceId: port.deviceId,
        remoteDeviceId: event.device_id,
        localValue: decision.localValue,
        remoteValue: decision.remoteValue,
        eventId: event.event_id,
        status: "open",
        resolution: null,
        resolvedAt: null,
      });
      await port.recordProcessed({
        id: event.event_id,
        device_id: event.device_id,
        processedAt: new Date().toISOString(),
        outcome: "conflict",
        detail: decision.field ?? null,
      });
      continue;
    }

    try {
      await port.applyRemote(event);
      report.applied += 1;
      await port.recordProcessed({
        id: event.event_id,
        device_id: event.device_id,
        processedAt: new Date().toISOString(),
        outcome: "applied",
        detail: event.event_type,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failed += 1;
      report.errors.push(message);
    }
  }

  return report;
}

export async function runSync(
  provider: DriveProvider,
  layout: VaultLayout,
  port: SyncPort,
): Promise<SyncReport> {
  const report = emptyReport();
  await pushEvents(provider, layout, port, report);
  await pullEvents(provider, layout, port, report);
  return report;
}
