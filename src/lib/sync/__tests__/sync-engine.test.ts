import { describe, expect, it } from "vitest";

import { FakeDriveProvider } from "../providers/fake-drive-provider";
import { DriveError } from "../providers/drive-provider";
import { createSyncEvent, toUploadPayload, validateRemoteEvent } from "../sync-events";
import { pullEvents, pushEvents, runSync, type SyncPort } from "../sync-engine";
import { ensureVault, eventFileName } from "../vault";
import type { ConflictRecord, ProcessedEvent, SyncEvent, SyncEventPayloadFile } from "../types";

interface Harness {
  port: SyncPort;
  events: Map<string, SyncEvent>;
  processed: Map<string, ProcessedEvent>;
  conflicts: ConflictRecord[];
  local: Map<string, Record<string, unknown> & { id: string }>;
  applied: SyncEventPayloadFile[];
}

function harness(options: { deviceId?: string; lastSyncAt?: string | null } = {}): Harness {
  const events = new Map<string, SyncEvent>();
  const processed = new Map<string, ProcessedEvent>();
  const conflicts: ConflictRecord[] = [];
  const local = new Map<string, Record<string, unknown> & { id: string }>();
  const applied: SyncEventPayloadFile[] = [];
  let conflictSeq = 0;

  const port: SyncPort = {
    deviceId: options.deviceId ?? "device-a",
    lastSyncAt: options.lastSyncAt ?? null,
    pendingEvents: async () => [...events.values()].filter((event) => event.status !== "uploaded"),
    markEventUploaded: async (id, fileId) => {
      const event = events.get(id);
      if (event) events.set(id, { ...event, status: "uploaded", remoteFileId: fileId });
    },
    markEventFailed: async (id, error) => {
      const event = events.get(id);
      if (event) events.set(id, { ...event, status: "failed", attempts: event.attempts + 1, lastError: error });
    },
    isProcessed: async (id) => processed.has(id),
    recordProcessed: async (record) => {
      processed.set(record.id, record);
    },
    localRecord: async (event) => local.get(String(event.payload["id"])) ?? null,
    applyRemote: async (event) => {
      applied.push(event);
      const record = event.payload["record"] as Record<string, unknown> & { id: string };
      local.set(record.id, record);
    },
    recordConflict: async (conflict) => {
      conflicts.push(conflict);
    },
    recordDriveFile: async () => {},
    describeEntity: (event) => ({
      store: String(event.payload["store"]),
      id: String(event.payload["id"]),
      label: `entity ${String(event.payload["id"])}`,
    }),
    newId: () => `conflict-${(conflictSeq += 1)}`,
  };

  return { port, events, processed, conflicts, local, applied };
}

function questEvent(overrides: Partial<{ id: string; deviceId: string; name: string; timestamp: string }> = {}) {
  const id = overrides.id ?? "quest-1";
  return createSyncEvent({
    deviceId: overrides.deviceId ?? "device-a",
    eventType: "upsert.quest",
    timestamp: overrides.timestamp ?? "2026-01-01T10:00:00.000Z",
    eventId: `evt-${id}-${overrides.deviceId ?? "device-a"}`,
    payload: {
      store: "quests",
      id,
      record: { id, name: overrides.name ?? "Run 3km", createdAt: overrides.timestamp ?? "2026-01-01T10:00:00.000Z" },
    },
  });
}

describe("push", () => {
  it("uploads pending events once and marks them uploaded", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const h = harness();
    const event = questEvent();
    h.events.set(event.id, event);

    const report = await pushEvents(provider, layout, h.port);

    expect(report.uploaded).toBe(1);
    expect(h.events.get(event.id)?.status).toBe("uploaded");
    const files = await provider.listFiles(layout.folderIds["events"]!);
    expect(files).toHaveLength(1);
  });

  it("never uploads the same event twice", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const h = harness();
    const event = questEvent();
    h.events.set(event.id, event);
    await pushEvents(provider, layout, h.port);

    // Simulate the event being pending again (e.g. an interrupted run).
    h.events.set(event.id, { ...event, status: "pending" });
    const report = await pushEvents(provider, layout, h.port);

    expect(report.uploaded).toBe(0);
    expect(report.skippedDuplicateUploads).toBe(1);
    expect(await provider.listFiles(layout.folderIds["events"]!)).toHaveLength(1);
  });

  it("keeps the event pending when Drive is offline", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const h = harness();
    const event = questEvent();
    h.events.set(event.id, event);
    provider.offline = true;

    await expect(pushEvents(provider, layout, h.port)).rejects.toBeInstanceOf(DriveError);
    expect(h.events.get(event.id)?.status).toBe("pending");
  });

  it("stops the run on an auth failure so the user is told to reconnect", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const h = harness();
    h.events.set("a", questEvent({ id: "q-a" }));
    provider.failNext = new DriveError("auth", "token expired");

    await expect(pushEvents(provider, layout, h.port)).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("pull", () => {
  it("applies a remote event from another device", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const remote = questEvent({ deviceId: "device-b", name: "Cold shower" });
    provider.seed(
      layout.folderIds["events"]!,
      eventFileName(remote.timestamp, remote.event_id),
      toUploadPayload(remote),
    );
    const h = harness();

    const report = await pullEvents(provider, layout, h.port);

    expect(report.applied).toBe(1);
    expect(h.local.get("quest-1")?.["name"]).toBe("Cold shower");
  });

  it("is idempotent — replaying the same file applies nothing new", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const remote = questEvent({ deviceId: "device-b" });
    provider.seed(
      layout.folderIds["events"]!,
      eventFileName(remote.timestamp, remote.event_id),
      toUploadPayload(remote),
    );
    const h = harness();
    await pullEvents(provider, layout, h.port);
    const second = await pullEvents(provider, layout, h.port);

    expect(second.applied).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(h.applied).toHaveLength(1);
  });

  it("acknowledges our own events without re-applying them", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const own = questEvent({ deviceId: "device-a" });
    provider.seed(
      layout.folderIds["events"]!,
      eventFileName(own.timestamp, own.event_id),
      toUploadPayload(own),
    );
    const h = harness();

    const report = await pullEvents(provider, layout, h.port);
    expect(report.applied).toBe(0);
    expect(h.applied).toHaveLength(0);
  });

  it("rejects malformed remote files instead of applying them", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    provider.seed(layout.folderIds["events"]!, "2026-01-01__evt-broken.json", { nope: true });
    const h = harness();

    const report = await pullEvents(provider, layout, h.port);
    expect(report.rejected).toBe(1);
    expect(report.applied).toBe(0);
    expect(h.processed.get("evt-broken")?.outcome).toBe("rejected");
  });

  it("raises a conflict when both devices changed the same field", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const remote = questEvent({ deviceId: "device-b", name: "Remote name", timestamp: "2026-01-02T10:00:00.000Z" });
    provider.seed(
      layout.folderIds["events"]!,
      eventFileName(remote.timestamp, remote.event_id),
      toUploadPayload(remote),
    );
    const h = harness({ lastSyncAt: "2026-01-01T00:00:00.000Z" });
    h.local.set("quest-1", {
      id: "quest-1",
      name: "Local name",
      createdAt: "2026-01-02T09:00:00.000Z",
      updatedAt: "2026-01-02T09:00:00.000Z",
    });

    const report = await pullEvents(provider, layout, h.port);

    expect(report.conflicts).toBe(1);
    expect(report.applied).toBe(0);
    expect(h.conflicts[0]).toMatchObject({ field: "name", status: "open" });
    // Local value survives until the human decides.
    expect(h.local.get("quest-1")?.["name"]).toBe("Local name");
  });
});

describe("runSync", () => {
  it("pushes then pulls in one pass", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const h = harness();
    const mine = questEvent({ id: "quest-mine" });
    h.events.set(mine.id, mine);
    const theirs = questEvent({ id: "quest-theirs", deviceId: "device-b" });
    provider.seed(
      layout.folderIds["events"]!,
      eventFileName(theirs.timestamp, theirs.event_id),
      toUploadPayload(theirs),
    );

    const report = await runSync(provider, layout, h.port);

    expect(report.uploaded).toBe(1);
    expect(report.applied).toBe(1);
  });
});

describe("event validation", () => {
  it("refuses events from a newer schema", () => {
    const result = validateRemoteEvent({
      event_id: "e1",
      device_id: "d1",
      timestamp: "2026-01-01T00:00:00.000Z",
      event_type: "upsert.quest",
      schema_version: 99,
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("keeps uploaded payloads free of local bookkeeping", () => {
    const payload = toUploadPayload(questEvent());
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("attempts");
  });
});
