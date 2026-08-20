import { describe, expect, it } from "vitest";

import { buildDriveContext, maskAccount, redactName } from "../drive-context";
import { decideEvent, mergeRecords } from "../conflict-engine";
import type { DriveFileRecord, SyncEventPayloadFile } from "../types";

const files: DriveFileRecord[] = [
  {
    id: "f1",
    name: "backup-daily-2026-03-10.json",
    folder: "backups",
    kind: "backup",
    modifiedTime: "2026-03-10T06:00:00.000Z",
    sizeBytes: 100,
    syncedAt: "2026-03-10T06:00:00.000Z",
  },
  {
    id: "f2",
    name: "2026-03-10__evt-1.json",
    folder: "events",
    kind: "event",
    modifiedTime: "2026-03-10T06:05:00.000Z",
    sizeBytes: 40,
    syncedAt: "2026-03-10T06:05:00.000Z",
  },
];

describe("controlled AI drive access", () => {
  it("shares nothing when drive context is off", () => {
    const block = buildDriveContext({
      enabled: false,
      connected: true,
      account: "player@example.com",
      files,
      lastSyncAt: null,
      lastBackupAt: null,
      openConflicts: 0,
    });
    expect(block.allowed).toBe(false);
    expect(block.text).toBe("");
  });

  it("shares metadata only, never raw event files or full account", () => {
    const block = buildDriveContext({
      enabled: true,
      connected: true,
      account: "player@example.com",
      files,
      lastSyncAt: "2026-03-10T06:00:00.000Z",
      lastBackupAt: "2026-03-10T06:00:00.000Z",
      openConflicts: 1,
    });
    expect(block.allowed).toBe(true);
    expect(block.text).toContain("backup-daily");
    expect(block.text).not.toContain("evt-1");
    expect(block.text).not.toContain("player@example.com");
  });

  it("masks accounts and redacts ids", () => {
    expect(maskAccount("player@example.com")).toBe("pl***@example.com");
    expect(maskAccount(null)).toBe("unknown");
    expect(redactName("backup-6f1c2b3d-1111-2222-3333-444455556666.json")).toBe("backup-<id>.json");
  });
});

function event(record: Record<string, unknown>): SyncEventPayloadFile {
  return {
    event_id: "e1",
    device_id: "device-b",
    timestamp: "2026-03-10T10:00:00.000Z",
    event_type: "upsert.quest",
    schema_version: 1,
    payload: { store: "quests", id: "q1", record },
  };
}

describe("conflict rules", () => {
  it("applies remote when there is no local record", () => {
    expect(decideEvent({ event: event({ id: "q1" }), local: null, lastSyncAt: null, alreadyProcessed: false }))
      .toEqual({ kind: "apply" });
  });

  it("treats processed ids as duplicates", () => {
    expect(
      decideEvent({ event: event({ id: "q1" }), local: null, lastSyncAt: null, alreadyProcessed: true }).kind,
    ).toBe("duplicate");
  });

  it("applies remote when local was untouched since the last sync", () => {
    const decision = decideEvent({
      event: event({ id: "q1", name: "Remote" }),
      local: { id: "q1", name: "Old", updatedAt: "2026-03-01T00:00:00.000Z" },
      lastSyncAt: "2026-03-05T00:00:00.000Z",
      alreadyProcessed: false,
    });
    expect(decision.kind).toBe("apply");
  });

  it("treats identical records as stale, not a conflict", () => {
    const decision = decideEvent({
      event: event({ id: "q1", name: "Same" }),
      local: { id: "q1", name: "Same", updatedAt: "2026-03-10T09:00:00.000Z" },
      lastSyncAt: "2026-03-01T00:00:00.000Z",
      alreadyProcessed: false,
    });
    expect(decision.kind).toBe("stale");
  });

  it("merges only into empty local fields", () => {
    const merged = mergeRecords(
      { id: "q1", name: "Local", description: "" },
      { name: "Remote", description: "From other device" },
    );
    expect(merged["name"]).toBe("Local");
    expect(merged["description"]).toBe("From other device");
  });
});
