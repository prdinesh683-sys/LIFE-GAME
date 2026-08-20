import { createServerFn } from "@tanstack/react-start";

/**
 * Typed RPC surface for the Google Drive vault. Every handler talks to the
 * connector gateway server-side and returns plain DTOs.
 */

interface DriveFileDto {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedTime: string | null;
}

function fail(status: number, body: string): never {
  throw new Error(`DRIVE_${status}:${body.slice(0, 400)}`);
}

function toFile(raw: Record<string, unknown>): DriveFileDto {
  const size = raw["size"];
  return {
    id: String(raw["id"] ?? ""),
    name: String(raw["name"] ?? ""),
    mimeType: typeof raw["mimeType"] === "string" ? raw["mimeType"] : null,
    sizeBytes: typeof size === "string" ? Number(size) : typeof size === "number" ? size : null,
    modifiedTime: typeof raw["modifiedTime"] === "string" ? raw["modifiedTime"] : null,
  };
}

export const driveStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { driveConfigured } = await import("./drive-gateway.server");
  return { configured: driveConfigured() };
});

export const driveVerify = createServerFn({ method: "POST" }).handler(async () => {
  const { driveGet } = await import("./drive-gateway.server");
  const res = await driveGet("/drive/v3/about?fields=user(emailAddress,displayName),storageQuota");
  if (!res.ok) fail(res.status, res.body);
  const parsed = JSON.parse(res.body) as {
    user?: { emailAddress?: string; displayName?: string };
    storageQuota?: { limit?: string; usage?: string };
  };
  return {
    account: parsed.user?.emailAddress ?? parsed.user?.displayName ?? "connected account",
    quotaUsed: parsed.storageQuota?.usage ? Number(parsed.storageQuota.usage) : null,
    quotaLimit: parsed.storageQuota?.limit ? Number(parsed.storageQuota.limit) : null,
  };
});

export const driveEnsureFolder = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; parentId: string | null }) => data)
  .handler(async ({ data }) => {
    const { driveGet, driveJson } = await import("./drive-gateway.server");
    const safeName = data.name.replace(/'/g, "\\'");
    const parentClause = data.parentId ? `'${data.parentId}' in parents` : "'root' in parents";
    const query = encodeURIComponent(
      `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false and ${parentClause}`,
    );
    const found = await driveGet(`/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`);
    if (found.ok) {
      const files = (JSON.parse(found.body) as { files?: { id: string }[] }).files ?? [];
      if (files[0]?.id) return { id: files[0].id, created: false };
    }
    const created = await driveJson("POST", "/drive/v3/files?fields=id", {
      name: data.name,
      mimeType: "application/vnd.google-apps.folder",
      ...(data.parentId ? { parents: [data.parentId] } : {}),
    });
    if (!created.ok) fail(created.status, created.body);
    return { id: String((JSON.parse(created.body) as { id: string }).id), created: true };
  });

export const driveListFiles = createServerFn({ method: "POST" })
  .inputValidator((data: { folderId: string }) => data)
  .handler(async ({ data }) => {
    const { driveGet } = await import("./drive-gateway.server");
    const query = encodeURIComponent(`'${data.folderId}' in parents and trashed=false`);
    const res = await driveGet(
      `/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=1000&orderBy=modifiedTime desc`,
    );
    if (!res.ok) fail(res.status, res.body);
    const files = (JSON.parse(res.body) as { files?: Record<string, unknown>[] }).files ?? [];
    return { files: files.map(toFile) };
  });

export const driveUploadJson = createServerFn({ method: "POST" })
  .inputValidator((data: { folderId: string; name: string; content: string; fileId?: string }) => data)
  .handler(async ({ data }) => {
    const { driveUploadMultipart } = await import("./drive-gateway.server");
    const metadata = data.fileId
      ? { name: data.name }
      : { name: data.name, parents: [data.folderId], mimeType: "application/json" };
    const res = await driveUploadMultipart(metadata, data.content, data.fileId);
    if (!res.ok) fail(res.status, res.body);
    return { file: toFile(JSON.parse(res.body) as Record<string, unknown>) };
  });

export const driveDownloadJson = createServerFn({ method: "POST" })
  .inputValidator((data: { fileId: string }) => data)
  .handler(async ({ data }) => {
    const { driveGet } = await import("./drive-gateway.server");
    const res = await driveGet(`/drive/v3/files/${data.fileId}?alt=media`);
    if (!res.ok) fail(res.status, res.body);
    return { content: res.body };
  });

export const driveMoveFile = createServerFn({ method: "POST" })
  .inputValidator((data: { fileId: string; fromFolderId: string; toFolderId: string }) => data)
  .handler(async ({ data }) => {
    const { driveJson } = await import("./drive-gateway.server");
    const res = await driveJson(
      "PATCH",
      `/drive/v3/files/${data.fileId}?addParents=${data.toFolderId}&removeParents=${data.fromFolderId}&fields=id`,
      {},
    );
    if (!res.ok) fail(res.status, res.body);
    return { ok: true };
  });

export const driveDeleteFile = createServerFn({ method: "POST" })
  .inputValidator((data: { fileId: string }) => data)
  .handler(async ({ data }) => {
    const { driveDeleteRaw } = await import("./drive-gateway.server");
    const res = await driveDeleteRaw(`/drive/v3/files/${data.fileId}`);
    if (!res.ok && res.status !== 404) fail(res.status, res.body);
    return { ok: true };
  });

export const driveSearchFiles = createServerFn({ method: "POST" })
  .inputValidator((data: { query: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { driveGet } = await import("./drive-gateway.server");
    const q = encodeURIComponent(data.query);
    const res = await driveGet(
      `/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=${Math.min(data.limit ?? 20, 100)}&orderBy=modifiedTime desc`,
    );
    if (!res.ok) fail(res.status, res.body);
    const files = (JSON.parse(res.body) as { files?: Record<string, unknown>[] }).files ?? [];
    return { files: files.map(toFile) };
  });
