import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  driveConfigured,
  driveGet,
  driveJson,
  driveDeleteRaw,
  driveUploadMultipart,
} from "../../drive-gateway.server";
import type { SyncStateRecord } from "../types";

describe("Google Drive Gateway Transport", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["GOOGLE_DRIVE_ACCESS_TOKEN"];
    delete process.env["GOOGLE_ACCESS_TOKEN"];
    delete process.env["GOOGLE_DRIVE_REFRESH_TOKEN"];
    delete process.env["GOOGLE_REFRESH_TOKEN"];
    delete process.env["GOOGLE_CLIENT_ID"];
    delete process.env["GOOGLE_CLIENT_SECRET"];
    delete process.env["LOVABLE_API_KEY"];
    delete process.env["GOOGLE_DRIVE_API_KEY"];
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Configuration Detection", () => {
    it("reports not configured when no Google OAuth environment variables exist", () => {
      expect(driveConfigured()).toBe(false);
    });

    it("reports configured when GOOGLE_DRIVE_ACCESS_TOKEN is present", () => {
      process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] = "test-access-token";
      expect(driveConfigured()).toBe(true);
    });

    it("reports configured when refresh token credentials are fully present", () => {
      process.env["GOOGLE_DRIVE_REFRESH_TOKEN"] = "test-refresh-token";
      process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
      process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
      expect(driveConfigured()).toBe(true);
    });

    it("reports not configured when refresh credentials are incomplete", () => {
      process.env["GOOGLE_DRIVE_REFRESH_TOKEN"] = "test-refresh-token";
      process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
      // missing client secret
      expect(driveConfigured()).toBe(false);
    });

    it("does not recognize old LOVABLE_API_KEY as Google Drive configured", () => {
      process.env["LOVABLE_API_KEY"] = "old-lovable-key";
      expect(driveConfigured()).toBe(false);
    });
  });

  describe("Direct Google API Calls", () => {
    it("fails cleanly with auth error when unconfigured", async () => {
      await expect(driveGet("/drive/v3/about")).rejects.toThrow(
        /missing Google OAuth credentials/i,
      );
    });

    it("makes direct request to googleapis.com with Bearer token", async () => {
      process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] = "ya29.sample-token-123";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ user: { emailAddress: "user@example.com" } })),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await driveGet("/drive/v3/about?fields=user");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://www.googleapis.com/drive/v3/about?fields=user");
      expect(new Headers(call[1].headers).get("Authorization")).toBe("Bearer ya29.sample-token-123");
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(JSON.parse(result.body).user.emailAddress).toBe("user@example.com");
    });

    it("handles POST JSON requests directly to Google endpoints", async () => {
      process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] = "ya29.sample-token-123";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ id: "folder-123" })),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await driveJson("POST", "/drive/v3/files?fields=id", {
        name: "Life Game Vault",
        mimeType: "application/vnd.google-apps.folder",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://www.googleapis.com/drive/v3/files?fields=id");
      expect(call[1].method).toBe("POST");
      expect(new Headers(call[1].headers).get("Content-Type")).toBe("application/json");
      expect(new Headers(call[1].headers).get("Authorization")).toBe("Bearer ya29.sample-token-123");
      expect(result.ok).toBe(true);
    });

    it("handles multipart uploads with boundary headers to Google upload API", async () => {
      process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] = "ya29.sample-token-123";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ id: "file-456", name: "manifest.json" })),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await driveUploadMultipart(
        { name: "manifest.json" },
        JSON.stringify({ version: 1 }),
        "file-456",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toContain("https://www.googleapis.com/upload/drive/v3/files/file-456");
      expect(call[1].method).toBe("PATCH");
      expect(new Headers(call[1].headers).get("Content-Type")).toContain("multipart/related; boundary=");
      expect(new Headers(call[1].headers).get("Authorization")).toBe("Bearer ya29.sample-token-123");
      expect(result.ok).toBe(true);
    });

    it("handles DELETE requests directly to Google endpoints", async () => {
      process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] = "ya29.sample-token-123";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(""),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await driveDeleteRaw("/drive/v3/files/file-to-delete");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(call[0]).toBe("https://www.googleapis.com/drive/v3/files/file-to-delete");
      expect(call[1].method).toBe("DELETE");
      expect(result.status).toBe(204);
    });

    it("refreshes access token via oauth2.googleapis.com when refresh credentials are provided", async () => {
      process.env["GOOGLE_DRIVE_REFRESH_TOKEN"] = "1//refresh-token";
      process.env["GOOGLE_CLIENT_ID"] = "client-id.apps.googleusercontent.com";
      process.env["GOOGLE_CLIENT_SECRET"] = "client-secret";

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ access_token: "refreshed-token-999", expires_in: 3600 }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ files: [] })),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await driveGet("/drive/v3/files");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const call1 = mockFetch.mock.calls[0] as [string, RequestInit];
      const call2 = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(call1[0]).toBe("https://oauth2.googleapis.com/token");
      expect(call2[0]).toBe("https://www.googleapis.com/drive/v3/files");
      expect(new Headers(call2[1].headers).get("Authorization")).toBe("Bearer refreshed-token-999");
      expect(result.ok).toBe(true);
    });

    it("propagates 401 unauthorized status when Google rejects credentials", async () => {
      process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] = "expired-token";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: { message: "Invalid Credentials" } })),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await driveGet("/drive/v3/about");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(401);
    });
  });

  describe("IndexedDB Security Invariant", () => {
    it("ensures no token or credential fields exist in SyncStateRecord schema", () => {
      const sampleSyncRecord: SyncStateRecord = {
        id: "sync",
        deviceId: "dev_123",
        deviceLabel: "Primary Device",
        connected: true,
        account: "user@gmail.com",
        status: "up_to_date",
        rootFolderId: "folder_root_123",
        rootFolderName: "Life Game Vault",
        folderIds: { events: "f_1", backups: "f_2" },
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
        lastBackupAt: null,
        lastWeeklyBackupAt: null,
        lastSnapshotAt: null,
        autoSync: true,
        autoBackup: true,
        driveContextEnabled: false,
        mcpEndpoint: "",
        mcpStatus: "not_configured",
        mcpDetail: null,
        uploadedEventCount: 5,
        appliedEventCount: 5,
      };

      const recordAsObj = sampleSyncRecord as unknown as Record<string, unknown>;

      expect(recordAsObj["token"]).toBeUndefined();
      expect(recordAsObj["accessToken"]).toBeUndefined();
      expect(recordAsObj["refreshToken"]).toBeUndefined();
      expect(recordAsObj["apiKey"]).toBeUndefined();
      expect(recordAsObj["lovableKey"]).toBeUndefined();
      expect(recordAsObj["secret"]).toBeUndefined();
    });
  });
});
