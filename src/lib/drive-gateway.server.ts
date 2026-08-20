/**
 * Server-only Google Drive gateway helper. Runs on the server so OAuth
 * tokens and credentials never reach client storage.
 *
 * Connects directly to the official Google Drive v3 REST API (https://www.googleapis.com).
 */

const GOOGLE_API_BASE = "https://www.googleapis.com";

export interface GatewayResult {
  ok: boolean;
  status: number;
  body: string;
}

interface GoogleCredentials {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function getCredentials(): GoogleCredentials {
  return {
    accessToken: process.env["GOOGLE_DRIVE_ACCESS_TOKEN"] || process.env["GOOGLE_ACCESS_TOKEN"],
    refreshToken: process.env["GOOGLE_DRIVE_REFRESH_TOKEN"] || process.env["GOOGLE_REFRESH_TOKEN"],
    clientId: process.env["GOOGLE_CLIENT_ID"],
    clientSecret: process.env["GOOGLE_CLIENT_SECRET"],
  };
}

export function driveConfigured(): boolean {
  const creds = getCredentials();
  return Boolean(creds.accessToken || (creds.refreshToken && creds.clientId && creds.clientSecret));
}

async function resolveAccessToken(): Promise<string> {
  const creds = getCredentials();

  // 1. Direct static access token from environment
  if (creds.accessToken) {
    return creds.accessToken;
  }

  // 2. Cached refreshed token
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  // 3. Refresh token flow via Google OAuth2 token endpoint
  if (creds.refreshToken && creds.clientId && creds.clientSecret) {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text();
      throw new Error(`Failed to refresh Google Drive access token: ${tokenRes.status} ${errorBody}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; expires_in?: number };
    const token = tokenData.access_token;
    const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
    cachedAccessToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  }

  throw new Error("Google Drive is not connected on the server (missing Google OAuth credentials).");
}

async function call(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<GatewayResult> {
  const token = await resolveAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${GOOGLE_API_BASE}${normalizedPath}`;

  const response = await fetch(url, { ...init, headers });
  const body = await response.text();
  return { ok: response.ok, status: response.status, body };
}

export function driveGet(path: string) {
  return call(path, { method: "GET" });
}

export function driveJson(method: string, path: string, payload: unknown) {
  return call(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function driveDeleteRaw(path: string) {
  return call(path, { method: "DELETE" });
}

/** Multipart upload: metadata + JSON body in one request. */
export function driveUploadMultipart(
  metadata: Record<string, unknown>,
  content: string,
  fileId?: string,
) {
  const boundary = `lifegame${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    `${content}\r\n--${boundary}--`;
  const path = fileId
    ? `/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime`
    : `/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime`;
  return call(path, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

