import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { LocalRepository, StoreName } from "../data/repository";
import { STORE_NAMES } from "../data/repository";
import { useGame } from "./game-store";
import { probeDriveMcp } from "../drive-mcp.functions";
import { driveStatus } from "../drive.functions";
import { buildDriveContext, type DriveContextBlock } from "../sync/drive-context";
import { publishDriveContextForAi } from "../sync/drive-context-bridge";
import {
  buildBackupFile,
  buildExportFile,
  buildManifest,
  dueBackups,
  uploadBackup,
  uploadExport,
  verifyBackupFile,
} from "../sync/backup-service";
import { mergeRecords } from "../sync/conflict-engine";
import { DriveError, type DriveProvider } from "../sync/providers/drive-provider";
import { GoogleDriveProvider } from "../sync/providers/google-drive-provider";
import { runSync, type SyncPort, type SyncReport } from "../sync/sync-engine";
import {
  buildOutboundEvents,
  describeEventEntity,
  prepareInbound,
  SYNCABLE_STORES,
  storeForEventType,
} from "../sync/sync-mapping";
import { APP_VERSION, resolveDeviceId } from "../sync/sync-events";
import type {
  BackupMetaRecord,
  ConflictRecord,
  ConflictResolution,
  DriveFileRecord,
  SyncEvent,
  SyncStateRecord,
  VaultManifest,
} from "../sync/types";
import { ensureVault, VAULT_ROOT, type VaultLayout } from "../sync/vault";
import type { MemoryRecord } from "../ai/records";
import {
  buildMemoryArchive,
  MEMORY_ARCHIVE_FOLDER,
  uploadMemoryArchive,
} from "../memory/memory-archive";

/** Stores that describe sync itself — never shipped inside a backup. */
const BOOKKEEPING_STORES: StoreName[] = [
  "syncEvents",
  "processedEvents",
  "syncState",
  "driveFiles",
];

const DEVICE_KEY = "life-game-device-id";

function defaultSyncState(deviceId: string): SyncStateRecord {
  return {
    id: "sync",
    deviceId,
    deviceLabel: typeof navigator === "undefined" ? "This device" : navigator.platform || "This device",
    status: "not_connected",
    lastSyncAt: null,
    lastSyncError: null,
    lastBackupAt: null,
    lastWeeklyBackupAt: null,
    lastSnapshotAt: null,
    connected: false,
    account: null,
    rootFolderName: VAULT_ROOT,
    rootFolderId: null,
    folderIds: {},
    autoSync: true,
    autoBackup: true,
    driveContextEnabled: false,
    mcpEndpoint: "",
    mcpStatus: "not_configured",
    mcpDetail: null,
    uploadedEventCount: 0,
    appliedEventCount: 0,
  };
}

export interface SyncStoreValue {
  ready: boolean;
  serverConfigured: boolean;
  state: SyncStateRecord | null;
  conflicts: ConflictRecord[];
  backups: BackupMetaRecord[];
  driveFiles: DriveFileRecord[];
  pendingCount: number;
  busy: null | "connect" | "sync" | "backup" | "restore" | "export" | "mcp";
  lastReport: SyncReport | null;
  message: string | null;
  driveContext: DriveContextBlock;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: (trigger?: string) => Promise<SyncReport | null>;
  backupNow: (type?: BackupMetaRecord["type"]) => Promise<void>;
  exportToDrive: () => Promise<void>;
  listRestorePoints: () => Promise<{ id: string; name: string; modifiedTime: string | null }[]>;
  restoreFromDrive: (fileId: string) => Promise<void>;
  restoreFromJson: (json: string) => Promise<void>;
  resolveConflict: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
  updateSyncSettings: (patch: Partial<SyncStateRecord>) => Promise<void>;
  /**
   * Phase 4B — selective memory archive. Only the ids the player selected are
   * uploaded; the memory database is never bulk-uploaded, and a Drive failure
   * throws without touching local memory.
   */
  archiveMemories: (
    memories: MemoryRecord[],
    selectedIds: string[],
  ) => Promise<{ fileId: string; name: string; count: number }>;
  /** Kept in memory for this session only — never persisted. */
  setMcpToken: (token: string) => void;
  testMcp: () => Promise<void>;
}

const SyncStoreContext = createContext<SyncStoreValue | null>(null);

export function SyncStoreProvider({ children }: { children: ReactNode }) {
  const { repository, snapshot } = useGame();
  const [state, setState] = useState<SyncStateRecord | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [backups, setBackups] = useState<BackupMetaRecord[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFileRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState<SyncStoreValue["busy"]>(null);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const providerRef = useRef<DriveProvider>(new GoogleDriveProvider());
  const runningRef = useRef(false);
  /** Session-only MCP token. Never written to IndexedDB or Drive. */
  const mcpTokenRef = useRef("");

  const refresh = useCallback(
    async (repo: LocalRepository) => {
      const [stored, conflictRows, backupRows, fileRows, events] = await Promise.all([
        repo.get("syncState", "sync"),
        repo.list("conflicts"),
        repo.list("backupMeta"),
        repo.list("driveFiles"),
        repo.list("syncEvents"),
      ]);
      setState(stored);
      setConflicts(
        [...conflictRows].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)),
      );
      setBackups([...backupRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setDriveFiles([...fileRows].sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? "")));
      setPendingCount(events.filter((event) => event.status !== "uploaded").length);
    },
    [],
  );

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    void (async () => {
      const deviceId = resolveDeviceId(
        () => localStorage.getItem(DEVICE_KEY),
        (value) => localStorage.setItem(DEVICE_KEY, value),
      );
      let stored = await repository.get("syncState", "sync");
      if (!stored) {
        stored = defaultSyncState(deviceId);
        await repository.put("syncState", stored);
      }
      const status = await driveStatus().catch(() => ({ configured: false }));
      if (cancelled) return;
      setServerConfigured(status.configured);
      await refresh(repository);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, repository]);

  const patchState = useCallback(
    async (patch: Partial<SyncStateRecord>) => {
      if (!repository) return null;
      const current = (await repository.get("syncState", "sync")) ?? defaultSyncState(
        resolveDeviceId(
          () => localStorage.getItem(DEVICE_KEY),
          (value) => localStorage.setItem(DEVICE_KEY, value),
        ),
      );
      const next: SyncStateRecord = { ...current, ...patch, id: "sync" };
      await repository.put("syncState", next);
      setState(next);
      return next;
    },
    [repository],
  );

  const ensureLayout = useCallback(
    async (current: SyncStateRecord): Promise<VaultLayout> => {
      if (current.rootFolderId && Object.keys(current.folderIds).length >= 6) {
        return { rootId: current.rootFolderId, folderIds: current.folderIds };
      }
      const layout = await ensureVault(providerRef.current, current.rootFolderName);
      await patchState({ rootFolderId: layout.rootId, folderIds: layout.folderIds });
      return layout;
    },
    [patchState],
  );

  const loadManifest = useCallback(
    async (layout: VaultLayout): Promise<VaultManifest | null> => {
      const files = await providerRef.current.listFiles(layout.rootId);
      const manifestFile = files.find((file) => file.name === "manifest.json");
      if (!manifestFile) return null;
      try {
        return (await providerRef.current.downloadJson(manifestFile.id)) as VaultManifest;
      } catch {
        return null;
      }
    },
    [],
  );

  const writeManifest = useCallback(
    async (layout: VaultLayout, current: SyncStateRecord, previous: VaultManifest | null) => {
      const manifest = buildManifest({
        deviceId: current.deviceId,
        deviceLabel: current.deviceLabel,
        previous,
        lastSyncAt: current.lastSyncAt,
        lastBackupAt: current.lastBackupAt,
        uploadedEventCount: current.uploadedEventCount,
        appliedEventCount: current.appliedEventCount,
      });
      // The vault holds exactly one manifest: update the existing file in place
      // and drop any duplicates left behind by earlier writes.
      const rootFiles = await providerRef.current
        .listFiles(layout.rootId)
        .catch(() => [] as { id: string; name: string }[]);
      const manifests = rootFiles.filter((file) => file.name === "manifest.json");
      const [keep, ...duplicates] = manifests;
      await providerRef.current.uploadJson(layout.rootId, "manifest.json", manifest, keep?.id);
      for (const duplicate of duplicates) {
        await providerRef.current.deleteFile(duplicate.id).catch(() => undefined);
      }
      return manifest;
    },
    [],
  );

  const failWith = useCallback(
    async (error: unknown) => {
      const driveError = error instanceof DriveError ? error : null;
      const text = driveError ? driveError.userMessage : error instanceof Error ? error.message : String(error);
      setMessage(text);
      await patchState({
        status: driveError?.kind === "auth" ? "error" : "error",
        lastSyncError: text,
        ...(driveError?.kind === "auth" ? { connected: false } : {}),
      });
    },
    [patchState],
  );

  const connect = useCallback(async () => {
    if (!repository) return;
    setBusy("connect");
    setMessage(null);
    try {
      const verified = await providerRef.current.verify();
      const current = await patchState({
        connected: true,
        account: verified.account,
        status: "pending",
        lastSyncError: null,
      });
      if (!current) return;
      const layout = await ensureVault(providerRef.current, current.rootFolderName);
      const withLayout = await patchState({ rootFolderId: layout.rootId, folderIds: layout.folderIds });
      if (withLayout) {
        const previous = await loadManifest(layout);
        await writeManifest(layout, withLayout, previous);
      }
      setMessage(`Vault ready in Google Drive as ${verified.account}.`);
      await refresh(repository);
    } catch (error) {
      await failWith(error);
    } finally {
      setBusy(null);
    }
  }, [failWith, loadManifest, patchState, refresh, repository, writeManifest]);

  const disconnect = useCallback(async () => {
    await patchState({
      connected: false,
      status: "not_connected",
      account: null,
      rootFolderId: null,
      folderIds: {},
      lastSyncError: null,
    });
    setMessage("Disconnected. Your game keeps running locally — nothing was deleted.");
  }, [patchState]);

  const collectData = useCallback(
    async (repo: LocalRepository) => {
      const all = await repo.exportAll();
      const data: Record<string, unknown[]> = {};
      for (const name of STORE_NAMES) {
        if (BOOKKEEPING_STORES.includes(name)) continue;
        data[name] = all[name] ?? [];
      }
      return data;
    },
    [],
  );

  const makePort = useCallback(
    (repo: LocalRepository, current: SyncStateRecord): SyncPort => ({
      deviceId: current.deviceId,
      lastSyncAt: current.lastSyncAt,
      pendingEvents: async () => {
        const rows = await repo.list("syncEvents");
        return rows.filter((event) => event.status !== "uploaded");
      },
      markEventUploaded: async (eventId, remoteFileId) => {
        const event = await repo.get("syncEvents", eventId);
        if (event) await repo.put("syncEvents", { ...event, status: "uploaded", remoteFileId, lastError: null });
      },
      markEventFailed: async (eventId, error) => {
        const event = await repo.get("syncEvents", eventId);
        if (event) {
          await repo.put("syncEvents", {
            ...event,
            status: "failed",
            attempts: event.attempts + 1,
            lastError: error,
          });
        }
      },
      isProcessed: async (eventId) => Boolean(await repo.get("processedEvents", eventId)),
      recordProcessed: async (record) => {
        await repo.put("processedEvents", record);
      },
      localRecord: async (event) => {
        const store = String(event.payload["store"] ?? "");
        const id = String(event.payload["id"] ?? "");
        if (!STORE_NAMES.includes(store as StoreName) || !id) return null;
        const row = (await repo.get(store as StoreName, id)) as Record<string, unknown> | null;
        if (!row) return null;
        const config = SYNCABLE_STORES.find((entry) => entry.store === store);
        return {
          ...row,
          id,
          updatedAt: config ? config.touchedAt(row) : undefined,
        } as Record<string, unknown> & { id: string };
      },
      applyRemote: async (event) => {
        const store = String(event.payload["store"] ?? "");
        const record = event.payload["record"];
        if (!STORE_NAMES.includes(store as StoreName) || !record || typeof record !== "object") {
          throw new Error(`Unknown sync target: ${event.event_type}`);
        }
        if (!storeForEventType(event.event_type)) {
          throw new Error(`Unsupported event type: ${event.event_type}`);
        }
        const id = String(event.payload["id"] ?? "");
        const local = id
          ? ((await repo.get(store as StoreName, id)) as Record<string, unknown> | null)
          : null;
        // Partial-contract stores (game configuration) merge instead of overwrite.
        const next = prepareInbound(
          event.event_type,
          record as Record<string, unknown>,
          local,
        );
        if (!next) return;
        await repo.put(store as StoreName, next as never);
      },
      recordConflict: async (conflict) => {
        await repo.put("conflicts", conflict);
      },
      recordDriveFile: async (record) => {
        await repo.put("driveFiles", record);
      },
      describeEntity: (event) => describeEventEntity(event),
      newId: () => `conflict-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    }),
    [],
  );

  const queueOutbound = useCallback(
    async (repo: LocalRepository, current: SyncStateRecord) => {
      const groups = await Promise.all(
        SYNCABLE_STORES.map(async (entry) => ({
          store: entry.store,
          rows: (await repo.list(entry.store)) as unknown as Record<string, unknown>[],
        })),
      );
      const events = buildOutboundEvents({
        deviceId: current.deviceId,
        since: current.lastSyncAt,
        records: groups,
      });
      const fresh: SyncEvent[] = [];
      for (const event of events) {
        const existing = await repo.get("syncEvents", event.id);
        if (existing) continue;
        fresh.push(event);
      }
      if (fresh.length) await repo.putMany("syncEvents", fresh);
      return fresh.length;
    },
    [],
  );

  const syncNow = useCallback(
    async (trigger = "manual"): Promise<SyncReport | null> => {
      if (!repository) return null;
      if (runningRef.current) return null;
      const current = await repository.get("syncState", "sync");
      if (!current?.connected) return null;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Offline: still queue the local changes so they upload on reconnect.
        await queueOutbound(repository, current);
        await patchState({ status: "offline" });
        await refresh(repository);
        return null;
      }
      runningRef.current = true;
      setBusy("sync");
      setMessage(null);
      try {
        await patchState({ status: "syncing" });
        await queueOutbound(repository, current);
        const layout = await ensureLayout(current);
        const port = makePort(repository, current);
        const report = await runSync(providerRef.current, layout, port);
        const startedAt = new Date().toISOString();
        const openConflicts = (await repository.list("conflicts")).filter((c) => c.status === "open");
        const updated = await patchState({
          status: openConflicts.length ? "conflict" : report.failed ? "pending" : "up_to_date",
          lastSyncAt: startedAt,
          lastSyncError: report.errors[0] ?? null,
          uploadedEventCount: current.uploadedEventCount + report.uploaded,
          appliedEventCount: current.appliedEventCount + report.applied,
        });
        if (updated) {
          const previous = await loadManifest(layout);
          await writeManifest(layout, updated, previous);
          if (updated.autoBackup) {
            const due = dueBackups({
              lastDailyAt: updated.lastBackupAt,
              lastWeeklyAt: updated.lastWeeklyBackupAt,
              now: new Date(),
            });
            for (const type of due) {
              await runBackup(repository, updated, layout, type);
            }
          }
        }
        setLastReport(report);
        setMessage(
          `Sync (${trigger}): ${report.uploaded} up, ${report.applied} applied, ${report.duplicates} duplicates skipped, ${report.conflicts} conflicts.`,
        );
        await refresh(repository);
        return report;
      } catch (error) {
        await failWith(error);
        await refresh(repository);
        return null;
      } finally {
        runningRef.current = false;
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureLayout, failWith, loadManifest, makePort, patchState, queueOutbound, refresh, repository, writeManifest],
  );

  const runBackup = useCallback(
    async (
      repo: LocalRepository,
      current: SyncStateRecord,
      layout: VaultLayout,
      type: BackupMetaRecord["type"],
    ) => {
      const data = await collectData(repo);
      const previous = await loadManifest(layout);
      const manifest = buildManifest({
        deviceId: current.deviceId,
        deviceLabel: current.deviceLabel,
        previous,
        lastSyncAt: current.lastSyncAt,
        lastBackupAt: current.lastBackupAt,
        uploadedEventCount: current.uploadedEventCount,
        appliedEventCount: current.appliedEventCount,
      });
      const file = buildBackupFile({ data, deviceId: current.deviceId, manifest });
      const meta = await uploadBackup(
        providerRef.current,
        layout,
        file,
        type,
        `backup-${file.createdAt}-${type}`,
      );
      await repo.put("backupMeta", meta);
      await repo.put("driveFiles", {
        id: meta.driveFileId ?? meta.id,
        name: meta.fileName,
        folder: "backups",
        kind: "backup",
        modifiedTime: meta.createdAt,
        sizeBytes: meta.sizeBytes,
        syncedAt: new Date().toISOString(),
      });
      await patchState(
        type === "weekly"
          ? { lastWeeklyBackupAt: meta.createdAt, lastBackupAt: meta.createdAt }
          : { lastBackupAt: meta.createdAt },
      );
      return meta;
    },
    [collectData, loadManifest, patchState],
  );

  /**
   * Uploads exactly the selected memories to the vault's memory folder and only
   * reports success once Drive confirmed the file. Local memory is untouched:
   * the caller archives locally after this resolves.
   */
  const archiveMemories = useCallback(
    async (memories: MemoryRecord[], selectedIds: string[]) => {
      if (!repository) throw new Error("Storage is not ready yet.");
      const current = await repository.get("syncState", "sync");
      if (!current?.connected) throw new Error("Connect Google Drive first.");
      const file = buildMemoryArchive({
        memories,
        selectedIds,
        deviceId: current.deviceId,
      });
      const result = await uploadMemoryArchive(providerRef.current, file);
      await repository.put("driveFiles", {
        id: result.fileId,
        name: result.name,
        folder: MEMORY_ARCHIVE_FOLDER,
        kind: "memory",
        modifiedTime: file.createdAt,
        sizeBytes: null,
        syncedAt: new Date().toISOString(),
      });
      await refresh(repository);
      return result;
    },
    [refresh, repository],
  );

  const backupNow = useCallback(
    async (type: BackupMetaRecord["type"] = "manual") => {
      if (!repository) return;
      const current = await repository.get("syncState", "sync");
      if (!current?.connected) {
        setMessage("Connect Google Drive first.");
        return;
      }
      setBusy("backup");
      setMessage(null);
      try {
        const layout = await ensureLayout(current);
        const meta = await runBackup(repository, current, layout, type);
        setMessage(
          meta.verified
            ? `Backup verified in Drive · ${meta.recordCount} records.`
            : "Backup uploaded but could not be verified — keep the local copy.",
        );
        await refresh(repository);
      } catch (error) {
        await failWith(error);
      } finally {
        setBusy(null);
      }
    },
    [ensureLayout, failWith, refresh, repository, runBackup],
  );

  const exportToDrive = useCallback(async () => {
    if (!repository) return;
    const current = await repository.get("syncState", "sync");
    if (!current?.connected) {
      setMessage("Connect Google Drive first.");
      return;
    }
    setBusy("export");
    try {
      const layout = await ensureLayout(current);
      const data = await collectData(repository);
      const manifest = buildManifest({
        deviceId: current.deviceId,
        deviceLabel: current.deviceLabel,
        previous: await loadManifest(layout),
        lastSyncAt: current.lastSyncAt,
        lastBackupAt: current.lastBackupAt,
        uploadedEventCount: current.uploadedEventCount,
        appliedEventCount: current.appliedEventCount,
      });
      const file = buildExportFile({ data, deviceId: current.deviceId, manifest });
      const uploaded = await uploadExport(providerRef.current, layout, file);
      await repository.put("driveFiles", {
        id: uploaded.id,
        name: uploaded.name,
        folder: "exports",
        kind: "export",
        modifiedTime: file.createdAt,
        sizeBytes: JSON.stringify(file).length,
        syncedAt: new Date().toISOString(),
      });
      setMessage(`Export written to Drive · ${file.recordCount} records.`);
      await refresh(repository);
    } catch (error) {
      await failWith(error);
    } finally {
      setBusy(null);
    }
  }, [collectData, ensureLayout, failWith, loadManifest, refresh, repository]);

  const listRestorePoints = useCallback(async () => {
    if (!repository) return [];
    const current = await repository.get("syncState", "sync");
    if (!current?.connected) return [];
    const layout = await ensureLayout(current);
    const folders = [layout.folderIds["backups"], layout.folderIds["exports"]].filter(
      (id): id is string => Boolean(id),
    );
    const results: { id: string; name: string; modifiedTime: string | null }[] = [];
    for (const folderId of folders) {
      const files = await providerRef.current.listFiles(folderId);
      results.push(
        ...files.map((file) => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime })),
      );
    }
    return results.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
  }, [ensureLayout, repository]);

  const applyRestore = useCallback(
    async (repo: LocalRepository, raw: unknown) => {
      const check = verifyBackupFile(raw);
      if (!check.ok) throw new Error(check.reason);
      const current = await repo.get("syncState", "sync");
      // Safety copy of the state we are about to overwrite.
      const safety = await collectData(repo);
      localStorage.setItem(
        "life-game-safety-copy",
        JSON.stringify({ createdAt: new Date().toISOString(), data: safety }),
      );
      try {
        await repo.importAll(check.file.data as Record<string, unknown[]>);
      } catch (error) {
        // Roll back to the safety copy so a failed restore never leaves a half-empty game.
        await repo.importAll(safety as Record<string, unknown[]>);
        throw new Error(
          `Restore failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (current) {
        await repo.put("syncState", { ...current, status: "pending", lastSyncError: null });
      }
      return check.recordCount;
    },
    [collectData],
  );

  const restoreFromDrive = useCallback(
    async (fileId: string) => {
      if (!repository) return;
      setBusy("restore");
      setMessage(null);
      try {
        const raw = await providerRef.current.downloadJson(fileId);
        const count = await applyRestore(repository, raw);
        setMessage(`Restored ${count} records from Drive. Reload to see the restored game.`);
        await refresh(repository);
      } catch (error) {
        await failWith(error);
      } finally {
        setBusy(null);
      }
    },
    [applyRestore, failWith, refresh, repository],
  );

  const restoreFromJson = useCallback(
    async (json: string) => {
      if (!repository) return;
      setBusy("restore");
      setMessage(null);
      try {
        const count = await applyRestore(repository, JSON.parse(json) as unknown);
        setMessage(`Restored ${count} records from file. Reload to see the restored game.`);
        await refresh(repository);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Restore failed.");
      } finally {
        setBusy(null);
      }
    },
    [applyRestore, refresh, repository],
  );

  const resolveConflict = useCallback(
    async (conflictId: string, resolution: ConflictResolution) => {
      if (!repository) return;
      const conflict = await repository.get("conflicts", conflictId);
      if (!conflict) return;
      if (resolution !== "review_later" && STORE_NAMES.includes(conflict.entityStore as StoreName)) {
        const store = conflict.entityStore as StoreName;
        const local = (await repository.get(store, conflict.entityId)) as Record<string, unknown> | null;
        if (resolution === "keep_remote" && conflict.field && local) {
          await repository.put(store, { ...local, [conflict.field]: conflict.remoteValue } as never);
        } else if (resolution === "merge" && local && conflict.field) {
          const merged = mergeRecords({ ...local, id: conflict.entityId }, {
            [conflict.field]: conflict.remoteValue,
          });
          await repository.put(store, merged as never);
        }
      }
      await repository.put("conflicts", {
        ...conflict,
        status: resolution === "review_later" ? "open" : "resolved",
        resolution,
        resolvedAt: resolution === "review_later" ? null : new Date().toISOString(),
      });
      const open = (await repository.list("conflicts")).filter((c) => c.status === "open");
      await patchState({ status: open.length ? "conflict" : "up_to_date" });
      await refresh(repository);
    },
    [patchState, refresh, repository],
  );

  const setMcpToken = useCallback((token: string) => {
    mcpTokenRef.current = token;
  }, []);

  const updateSyncSettings = useCallback(
    async (patch: Partial<SyncStateRecord>) => {
      // Defensive: no caller may smuggle a credential into the local database.
      const { mcpToken: _ignored, ...safe } = patch as Partial<SyncStateRecord> & { mcpToken?: string };
      await patchState(safe);
    },
    [patchState],
  );

  const testMcp = useCallback(async () => {
    if (!repository) return;
    const current = await repository.get("syncState", "sync");
    if (!current) return;
    setBusy("mcp");
    try {
      const result = await probeDriveMcp({
        data: {
          endpoint: current.mcpEndpoint,
          ...(mcpTokenRef.current ? { token: mcpTokenRef.current } : {}),
        },
      });
      await patchState({ mcpStatus: result.status, mcpDetail: result.detail });
      setMessage(result.detail);
    } catch (error) {
      await patchState({
        mcpStatus: "unavailable",
        mcpDetail: error instanceof Error ? error.message : "MCP probe failed.",
      });
    } finally {
      setBusy(null);
    }
  }, [patchState, repository]);

  /** Gentle automation: sync when the app opens, on reconnect, and after runs. */
  const completedRuns = snapshot?.questRuns.filter((run) => run.outcome !== "in_progress").length ?? 0;
  const openedRef = useRef(false);
  useEffect(() => {
    if (!ready || !state?.connected || !state.autoSync) return;
    if (openedRef.current) return;
    openedRef.current = true;
    void syncNow("app open");
  }, [ready, state?.autoSync, state?.connected, syncNow]);

  const runsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !state?.connected || !state.autoSync) return;
    if (runsRef.current === null) {
      runsRef.current = completedRuns;
      return;
    }
    if (completedRuns > runsRef.current) {
      runsRef.current = completedRuns;
      void syncNow("quest finished");
    }
  }, [completedRuns, ready, state?.autoSync, state?.connected, syncNow]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      if (state?.connected && state.autoSync) void syncNow("reconnected");
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [state?.autoSync, state?.connected, syncNow]);

  const driveContext = useMemo(
    () =>
      buildDriveContext({
        enabled: Boolean(state?.driveContextEnabled),
        connected: Boolean(state?.connected),
        account: state?.account ?? null,
        files: driveFiles,
        lastSyncAt: state?.lastSyncAt ?? null,
        lastBackupAt: state?.lastBackupAt ?? null,
        openConflicts: conflicts.filter((conflict) => conflict.status === "open").length,
      }),
    [conflicts, driveFiles, state],
  );

  useEffect(() => {
    publishDriveContextForAi(driveContext.allowed ? driveContext.text : null);
  }, [driveContext]);

  const value = useMemo<SyncStoreValue>(
    () => ({
      ready,
      serverConfigured,
      state,
      conflicts,
      backups,
      driveFiles,
      pendingCount,
      busy,
      lastReport,
      message,
      driveContext,
      connect,
      disconnect,
      syncNow,
      backupNow,
      exportToDrive,
      listRestorePoints,
      restoreFromDrive,
      restoreFromJson,
      resolveConflict,
      updateSyncSettings,
      setMcpToken,
      testMcp,
      archiveMemories,
    }),
    [
      archiveMemories,
      backupNow,
      backups,
      busy,
      conflicts,
      connect,
      disconnect,
      driveContext,
      driveFiles,
      exportToDrive,
      lastReport,
      listRestorePoints,
      message,
      pendingCount,
      ready,
      resolveConflict,
      restoreFromDrive,
      restoreFromJson,
      serverConfigured,
      state,
      syncNow,
      testMcp,
      updateSyncSettings,
    ],
  );

  return <SyncStoreContext.Provider value={value}>{children}</SyncStoreContext.Provider>;
}

export function useSync(): SyncStoreValue {
  const value = useContext(SyncStoreContext);
  if (!value) throw new Error("useSync must be used inside SyncStoreProvider");
  return value;
}

export { APP_VERSION };
