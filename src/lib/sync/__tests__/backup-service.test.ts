import { describe, expect, it } from "vitest";

import {
  buildBackupFile,
  buildManifest,
  checksum,
  dueBackups,
  uploadBackup,
  verifyBackupFile,
} from "../backup-service";
import { FakeDriveProvider } from "../providers/fake-drive-provider";
import { ensureVault } from "../vault";

const manifest = buildManifest({
  deviceId: "device-a",
  deviceLabel: "Phone",
  previous: null,
  lastSyncAt: null,
  lastBackupAt: null,
  uploadedEventCount: 0,
  appliedEventCount: 0,
});

const data = { quests: [{ id: "q1", name: "Run" }], events: [{ id: "e1" }] };

describe("backup", () => {
  it("builds a verifiable backup file", () => {
    const file = buildBackupFile({ data, deviceId: "device-a", manifest });
    expect(file.recordCount).toBe(2);
    const check = verifyBackupFile(file);
    expect(check.ok).toBe(true);
  });

  it("refuses a corrupted backup", () => {
    const file = buildBackupFile({ data, deviceId: "device-a", manifest });
    const tampered = { ...file, data: { quests: [{ id: "q1", name: "Tampered" }], events: [] } };
    const check = verifyBackupFile(tampered);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/checksum/i);
  });

  it("refuses a foreign file", () => {
    expect(verifyBackupFile({ kind: "something-else" }).ok).toBe(false);
    expect(verifyBackupFile("nope").ok).toBe(false);
  });

  it("refuses a future schema", () => {
    const file = buildBackupFile({ data, deviceId: "device-a", manifest });
    const check = verifyBackupFile({ ...file, schemaVersion: 999 });
    expect(check.ok).toBe(false);
  });

  it("uploads and reads the backup back to prove it exists", async () => {
    const provider = new FakeDriveProvider();
    const layout = await ensureVault(provider);
    const file = buildBackupFile({ data, deviceId: "device-a", manifest });
    const meta = await uploadBackup(provider, layout, file, "manual", "b1");
    expect(meta.verified).toBe(true);
    expect(meta.driveFileId).toBeTruthy();
  });

  it("keeps checksums stable and sensitive", () => {
    expect(checksum(data)).toBe(checksum({ ...data }));
    expect(checksum(data)).not.toBe(checksum({ quests: [], events: [] }));
  });
});

describe("manifest", () => {
  it("tracks devices without duplicating this one", () => {
    const second = buildManifest({
      deviceId: "device-a",
      deviceLabel: "Phone",
      previous: manifest,
      lastSyncAt: "2026-01-01T00:00:00.000Z",
      lastBackupAt: null,
      uploadedEventCount: 3,
      appliedEventCount: 1,
    });
    expect(second.devices.filter((device) => device.device_id === "device-a")).toHaveLength(1);
    expect(second.vaultVersion).toBe(manifest.vaultVersion + 1);
  });
});

describe("gentle automation", () => {
  const now = new Date("2026-03-10T12:00:00.000Z");

  it("asks for both backups on a fresh vault", () => {
    expect(dueBackups({ lastDailyAt: null, lastWeeklyAt: null, now })).toEqual(["daily", "weekly"]);
  });

  it("asks for nothing twice in one day", () => {
    expect(
      dueBackups({
        lastDailyAt: "2026-03-10T06:00:00.000Z",
        lastWeeklyAt: "2026-03-09T06:00:00.000Z",
        now,
      }),
    ).toEqual([]);
  });

  it("asks for the weekly backup after seven days", () => {
    expect(
      dueBackups({
        lastDailyAt: "2026-03-10T06:00:00.000Z",
        lastWeeklyAt: "2026-03-01T06:00:00.000Z",
        now,
      }),
    ).toEqual(["weekly"]);
  });
});
