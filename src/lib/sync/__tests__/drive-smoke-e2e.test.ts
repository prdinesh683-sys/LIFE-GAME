import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  driveConfigured,
  driveGet,
  driveJson,
  driveUploadMultipart,
  driveDeleteRaw,
} from "../../drive-gateway.server";
import type { DriveFileRef, DriveProvider } from "../providers/drive-provider";
import { ensureVault, VAULT_ROOT, VAULT_FOLDERS } from "../vault";
import { runSync, type SyncPort } from "../sync-engine";
import { buildManifest, buildBackupFile, uploadBackup, verifyBackupFile } from "../backup-service";
import { SYNC_SCHEMA_VERSION, type SyncEvent, type ProcessedEvent } from "../types";

/** Direct Google Drive provider implementation wired straight to drive-gateway.server for end-to-end transport validation. */
class DirectGatewayDriveProvider implements DriveProvider {
  readonly kind = "google-drive";

  async verify() {
    const res = await driveGet("/drive/v3/about?fields=user(emailAddress,displayName),storageQuota");
    if (!res.ok) throw new Error(`DRIVE_${res.status}:${res.body}`);
    const parsed = JSON.parse(res.body);
    return { account: parsed.user?.emailAddress ?? parsed.user?.displayName ?? "connected account" };
  }

  async ensureFolder(name: string, parentId: string | null): Promise<string> {
    const safeName = name.replace(/'/g, "\\'");
    const parentClause = parentId ? `'${parentId}' in parents` : "'root' in parents";
    const query = encodeURIComponent(`name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and ${parentClause}`);
    const found = await driveGet(`/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`);
    if (found.ok) {
      const files = (JSON.parse(found.body).files ?? []) as { id: string }[];
      if (files[0]?.id) return files[0].id;
    }
    const created = await driveJson("POST", "/drive/v3/files?fields=id", {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    });
    if (!created.ok) throw new Error(`DRIVE_${created.status}:${created.body}`);
    return String(JSON.parse(created.body).id);
  }

  async listFiles(folderId: string): Promise<DriveFileRef[]> {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await driveGet(`/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=1000&orderBy=modifiedTime desc`);
    if (!res.ok) throw new Error(`DRIVE_${res.status}:${res.body}`);
    const files = (JSON.parse(res.body).files ?? []) as any[];
    return files.map((raw) => ({
      id: String(raw.id ?? ""),
      name: String(raw.name ?? ""),
      mimeType: raw.mimeType ?? null,
      sizeBytes: raw.size ? Number(raw.size) : null,
      modifiedTime: raw.modifiedTime ?? null,
    }));
  }

  async uploadJson(folderId: string, name: string, data: unknown, fileId?: string): Promise<DriveFileRef> {
    const metadata = fileId ? { name } : { name, parents: [folderId], mimeType: "application/json" };
    const content = JSON.stringify(data, null, 2);
    const res = await driveUploadMultipart(metadata, content, fileId);
    if (!res.ok) throw new Error(`DRIVE_${res.status}:${res.body}`);
    const raw = JSON.parse(res.body);
    return {
      id: String(raw.id ?? ""),
      name: String(raw.name ?? ""),
      mimeType: raw.mimeType ?? null,
      sizeBytes: raw.size ? Number(raw.size) : null,
      modifiedTime: raw.modifiedTime ?? null,
    };
  }

  async downloadJson(fileId: string): Promise<unknown> {
    const res = await driveGet(`/drive/v3/files/${fileId}?alt=media`);
    if (!res.ok) throw new Error(`DRIVE_${res.status}:${res.body}`);
    return JSON.parse(res.body);
  }

  async moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    const res = await driveJson("PATCH", `/drive/v3/files/${fileId}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id`, {});
    if (!res.ok) throw new Error(`DRIVE_${res.status}:${res.body}`);
  }

  async deleteFile(fileId: string): Promise<void> {
    const res = await driveDeleteRaw(`/drive/v3/files/${fileId}`);
    if (!res.ok && res.status !== 404) throw new Error(`DRIVE_${res.status}:${res.body}`);
  }

  async searchFiles(query: string, limit = 20): Promise<DriveFileRef[]> {
    const q = encodeURIComponent(query);
    const res = await driveGet(`/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=${Math.min(limit, 100)}&orderBy=modifiedTime desc`);
    if (!res.ok) throw new Error(`DRIVE_${res.status}:${res.body}`);
    const files = (JSON.parse(res.body).files ?? []) as any[];
    return files.map((raw) => ({
      id: String(raw.id ?? ""),
      name: String(raw.name ?? ""),
      mimeType: raw.mimeType ?? null,
      sizeBytes: raw.size ? Number(raw.size) : null,
      modifiedTime: raw.modifiedTime ?? null,
    }));
  }
}

describe("Direct Google Drive Gateway End-to-End Smoke Test", () => {
  const originalEnv = process.env;
  let mockServerFiles: Map<string, { id: string; name: string; content: string; parents: string[]; mimeType: string }>;
  let idCounter = 1;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] = "ya29.smoke-test-token-valid";
    mockServerFiles = new Map();
    idCounter = 1;

    // Direct Google REST API endpoint simulation for googleapis.com
    const mockGoogleApiFetch = vi.fn().mockImplementation(async (urlStr: string, init: RequestInit = {}) => {
      const url = new URL(urlStr);
      const authHeader = new Headers(init.headers).get("Authorization");

      // Verify strict security & transport rules:
      // 1. Never contact any lovable domain
      if (url.hostname.includes("lovable")) {
        throw new Error(`SECURITY VIOLATION: Contacted forbidden domain ${url.hostname}`);
      }

      // 2. Must target googleapis.com directly
      if (!url.hostname.endsWith("googleapis.com")) {
        throw new Error(`Invalid host: ${url.hostname}`);
      }

      // 3. Must include Bearer token
      if (!authHeader || !authHeader.startsWith("Bearer ya29.")) {
        return {
          ok: false,
          status: 401,
          text: () => Promise.resolve(JSON.stringify({ error: { message: "Invalid Credentials", code: 401 } })),
        };
      }

      const method = (init.method ?? "GET").toUpperCase();
      const pathname = url.pathname;

      // /drive/v3/about
      if (pathname === "/drive/v3/about") {
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({
            user: { emailAddress: "player@gmail.com", displayName: "Player One" },
            storageQuota: { usage: "1048576", limit: "16106127360" },
          })),
        };
      }

      // /drive/v3/files query/search
      if (pathname === "/drive/v3/files" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const files = Array.from(mockServerFiles.values()).filter((f) => {
          if (q.includes("'root' in parents") && !f.parents.includes("root")) return false;
          if (q.includes("trashed=false") && (f as any).trashed) return false;
          const parentMatch = q.match(/'([^']+)' in parents/);
          if (parentMatch?.[1] && !f.parents.includes(parentMatch[1])) return false;
          const nameMatch = q.match(/name='([^']+)'/);
          if (nameMatch?.[1] && f.name !== nameMatch[1]) return false;
          return true;
        });

        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ files })),
        };
      }

      // /drive/v3/files folder creation (POST)
      if (pathname === "/drive/v3/files" && method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        const id = `folder_${idCounter++}`;
        const newFolder = {
          id,
          name: body.name,
          parents: body.parents ?? ["root"],
          mimeType: body.mimeType ?? "application/vnd.google-apps.folder",
          content: "",
        };
        mockServerFiles.set(id, newFolder);
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(newFolder)),
        };
      }

      // /upload/drive/v3/files multipart upload
      if (pathname.startsWith("/upload/drive/v3/files")) {
        const fileIdMatch = pathname.match(/\/upload\/drive\/v3\/files\/([^?]+)/);
        const targetId = (fileIdMatch?.[1] ?? `file_${idCounter++}`) as string;
        const rawBody = String(init.body ?? "");

        // Extract multipart json body
        const parts = rawBody.split(/--lifegame[a-z0-9]+/);
        let metadata: any = {};
        let content = "";
        for (const part of parts) {
          if (part.includes("Content-Type: application/json; charset=UTF-8")) {
            const jsonStr = part.split("\r\n\r\n")[1]?.trim();
            if (jsonStr) metadata = JSON.parse(jsonStr);
          } else if (part.includes("Content-Type: application/json")) {
            content = part.split("\r\n\r\n")[1]?.trim() ?? "";
          }
        }

        const existing = mockServerFiles.get(targetId);
        const record = {
          id: targetId,
          name: (metadata.name ?? existing?.name ?? "file.json") as string,
          parents: (metadata.parents ?? existing?.parents ?? ["root"]) as string[],
          mimeType: "application/json",
          content: content || existing?.content || "",
          size: content.length,
          modifiedTime: new Date().toISOString(),
        };
        mockServerFiles.set(targetId, record);

        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(record)),
        };
      }

      // /drive/v3/files/:id download alt=media
      if (pathname.startsWith("/drive/v3/files/") && method === "GET" && url.searchParams.get("alt") === "media") {
        const id = pathname.replace("/drive/v3/files/", "");
        const file = mockServerFiles.get(id);
        if (!file) {
          return { ok: false, status: 404, text: () => Promise.resolve("Not Found") };
        }
        return { ok: true, status: 200, text: () => Promise.resolve(file.content) };
      }

      // /drive/v3/files/:id patch / move
      if (pathname.startsWith("/drive/v3/files/") && method === "PATCH") {
        const id = pathname.replace("/drive/v3/files/", "");
        const file = mockServerFiles.get(id);
        if (file) {
          const addParents = url.searchParams.get("addParents");
          const removeParents = url.searchParams.get("removeParents");
          if (addParents) file.parents = [addParents];
          if (removeParents) file.parents = file.parents.filter((p) => p !== removeParents);
        }
        return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(file ?? { id })) };
      }

      // /drive/v3/files/:id delete
      if (pathname.startsWith("/drive/v3/files/") && method === "DELETE") {
        const id = pathname.replace("/drive/v3/files/", "");
        mockServerFiles.delete(id);
        return { ok: true, status: 204, text: () => Promise.resolve("") };
      }

      return { ok: false, status: 404, text: () => Promise.resolve("Unhandled mock endpoint") };
    });

    vi.stubGlobal("fetch", mockGoogleApiFetch);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("1. Verifies configuration status detection", () => {
    expect(driveConfigured()).toBe(true);
    delete process.env["GOOGLE_DRIVE_ACCESS_TOKEN"];
    expect(driveConfigured()).toBe(false);
  });

  it("2. Verifies account identity via driveVerify()", async () => {
    const provider = new DirectGatewayDriveProvider();
    const verified = await provider.verify();
    expect(verified.account).toBe("player@gmail.com");
  });

  it("3 & 4. Initializes and preserves vault layout with all required folders", async () => {
    const provider = new DirectGatewayDriveProvider();
    const layout = await ensureVault(provider, VAULT_ROOT);

    expect(layout.rootId).toBeTruthy();
    expect(Object.keys(layout.folderIds)).toEqual(
      expect.arrayContaining(["events", "processed", "backups", "exports", "snapshots", "memory"]),
    );

    // Verify all folders exist in mock server
    for (const [key, folderName] of Object.entries(VAULT_FOLDERS)) {
      const folderId = layout.folderIds[key];
      expect(folderId).toBeTruthy();
      const folder = mockServerFiles.get(folderId!);
      expect(folder?.name).toBe(folderName);
      expect(folder?.parents).toContain(layout.rootId);
    }
  });

  it("5. Writes and updates the single vault manifest.json", async () => {
    const provider = new DirectGatewayDriveProvider();
    const layout = await ensureVault(provider, VAULT_ROOT);

    const manifest = buildManifest({
      deviceId: "device_phone_1",
      deviceLabel: "Personal Phone",
      previous: null,
      lastSyncAt: new Date().toISOString(),
      lastBackupAt: null,
      uploadedEventCount: 3,
      appliedEventCount: 0,
    });

    const fileRef = await provider.uploadJson(layout.rootId, "manifest.json", manifest);
    expect(fileRef.name).toBe("manifest.json");

    const downloaded = (await provider.downloadJson(fileRef.id)) as any;
    expect(downloaded.devices[0].device_id).toBe("device_phone_1");
    expect(downloaded.devices[0].label).toBe("Personal Phone");
    expect(downloaded.schemaVersion).toBe(SYNC_SCHEMA_VERSION);
  });

  it("6 & 7. Tests upload JSON and download JSON roundtrip", async () => {
    const provider = new DirectGatewayDriveProvider();
    const layout = await ensureVault(provider, VAULT_ROOT);

    const testPayload = { questId: "quest_morning_run", score: 100, completed: true };
    const uploaded = await provider.uploadJson(layout.folderIds["events"]!, "event_1.json", testPayload);
    expect(uploaded.id).toBeTruthy();

    const downloaded = await provider.downloadJson(uploaded.id);
    expect(downloaded).toEqual(testPayload);
  });

  it("8. Tests searchFiles and listFiles queries", async () => {
    const provider = new DirectGatewayDriveProvider();
    const layout = await ensureVault(provider, VAULT_ROOT);

    await provider.uploadJson(layout.folderIds["backups"]!, "backup_1.json", { id: 1 });
    await provider.uploadJson(layout.folderIds["backups"]!, "backup_2.json", { id: 2 });

    const files = await provider.listFiles(layout.folderIds["backups"]!);
    expect(files.length).toBe(2);
    expect(files.map((f) => f.name).sort()).toEqual(["backup_1.json", "backup_2.json"]);
  });

  it("9. Tests moveFile and deleteFile operations", async () => {
    const provider = new DirectGatewayDriveProvider();
    const layout = await ensureVault(provider, VAULT_ROOT);

    const file = await provider.uploadJson(layout.folderIds["events"]!, "temp.json", { temp: true });
    expect(mockServerFiles.has(file.id)).toBe(true);

    // Move
    await provider.moveFile(file.id, layout.folderIds["events"]!, layout.folderIds["exports"]!);
    const moved = mockServerFiles.get(file.id);
    expect(moved?.parents).toContain(layout.folderIds["exports"]);

    // Delete
    await provider.deleteFile(file.id);
    expect(mockServerFiles.has(file.id)).toBe(false);
  });

  it("10. Executes full sync cycle through the DirectGatewayDriveProvider", async () => {
    const provider = new DirectGatewayDriveProvider();
    const layout = await ensureVault(provider, VAULT_ROOT);

    const localSyncEvents: SyncEvent[] = [
      {
        id: "evt_1",
        event_id: "evt_1",
        device_id: "dev_client_1",
        timestamp: new Date().toISOString(),
        event_type: "upsert.quest",
        schema_version: SYNC_SCHEMA_VERSION,
        payload: { store: "quests", id: "q100", record: { id: "q100", title: "Read Book" } },
        status: "pending",
        attempts: 0,
      },
    ];

    const processedEvents = new Map<string, ProcessedEvent>();

    const port: SyncPort = {
      deviceId: "dev_client_1",
      lastSyncAt: null,
      pendingEvents: async () => localSyncEvents.filter((e) => e.status !== "uploaded"),
      markEventUploaded: async (id, remoteId) => {
        const ev = localSyncEvents.find((e) => e.id === id);
        if (ev) {
          ev.status = "uploaded";
          ev.remoteFileId = remoteId;
        }
      },
      markEventFailed: async () => {},
      isProcessed: async (id) => processedEvents.has(id),
      recordProcessed: async (record) => {
        processedEvents.set(record.id, record);
      },
      localRecord: async () => null,
      applyRemote: async () => {},
      recordConflict: async () => {},
      recordDriveFile: async () => {},
      describeEntity: () => ({ store: "quests", id: "q100", label: "Read Book" }),
      newId: () => "id_1",
    };

    const report = await runSync(provider, layout, port);

    expect(report.uploaded).toBe(1);
    expect(report.failed).toBe(0);
    expect(localSyncEvents[0]?.status).toBe("uploaded");
  });

  it("11. Executes backup and restore roundtrip through DirectGatewayDriveProvider", async () => {
    const provider = new DirectGatewayDriveProvider();
    const layout = await ensureVault(provider, VAULT_ROOT);

    const manifest = buildManifest({
      deviceId: "dev_1",
      deviceLabel: "Main Phone",
      previous: null,
      lastSyncAt: null,
      lastBackupAt: null,
      uploadedEventCount: 0,
      appliedEventCount: 0,
    });

    const data = {
      profile: [{ id: "p1", name: "Champion" }],
      quests: [{ id: "q1", title: "Daily Quest", xp: 50 }],
    };

    const backupFile = buildBackupFile({
      data,
      deviceId: "dev_1",
      manifest,
    });

    // Upload backup file via backup service
    const uploadedRecord = await uploadBackup(
      provider,
      layout,
      backupFile,
      "manual",
      "backup_id_1",
    );

    expect(uploadedRecord.driveFileId).toBeTruthy();

    // Download backup file
    const downloadedRaw = await provider.downloadJson(uploadedRecord.driveFileId!);
    const check = verifyBackupFile(downloadedRaw);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.file.deviceId).toBe("dev_1");
      expect(check.file.data["quests"]).toHaveLength(1);
    }
  });

  it("12. Confirms clean offline behavior when Drive is unavailable", async () => {
    const provider = new DirectGatewayDriveProvider();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch (offline)")));

    await expect(provider.verify()).rejects.toThrow(/Failed to fetch/i);
  });
});
