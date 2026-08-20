/**
 * DriveProvider — the only boundary the sync/backup engines know about.
 *
 * GoogleDriveProvider talks to the real Drive through server functions.
 * FakeDriveProvider is an in-memory double used by the test suite.
 * DriveMcpProvider is an independent AI read layer, never the sync path.
 */

export interface DriveFileRef {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedTime: string | null;
}

export type DriveErrorKind =
  | "auth"
  | "network"
  | "permission"
  | "not_found"
  | "rate_limit"
  | "invalid"
  | "unknown";

export class DriveError extends Error {
  constructor(
    public readonly kind: DriveErrorKind,
    message: string,
    public readonly status?: number,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "DriveError";
  }

  /** Plain-language next step for the UI. */
  get userMessage(): string {
    switch (this.kind) {
      case "auth":
        return "Google Drive needs to be reconnected before syncing again.";
      case "permission":
        return "This Google account is not allowed to write to the vault folder.";
      case "not_found":
        return "That Drive file or folder no longer exists.";
      case "network":
        return "Drive is unreachable right now — the game keeps running offline.";
      case "rate_limit":
        return "Google Drive is rate limiting requests. Try again in a moment.";
      case "invalid":
        return "Drive rejected the request as invalid.";
      default:
        return this.message;
    }
  }
}

export function driveErrorFromStatus(status: number, detail: string): DriveError {
  if (status === 401) return new DriveError("auth", "Drive authentication failed", status, detail);
  if (status === 403) return new DriveError("permission", "Drive permission denied", status, detail);
  if (status === 404) return new DriveError("not_found", "Drive resource not found", status, detail);
  if (status === 429) return new DriveError("rate_limit", "Drive rate limited", status, detail);
  if (status >= 500) return new DriveError("network", "Drive is unavailable", status, detail);
  return new DriveError("invalid", `Drive request failed (${status})`, status, detail);
}

export interface DriveProvider {
  readonly kind: string;
  /** Real operation — never trust configuration alone. */
  verify(): Promise<{ account: string }>;
  /** Creates the folder if missing; returns its Drive id. */
  ensureFolder(name: string, parentId: string | null): Promise<string>;
  listFiles(folderId: string): Promise<DriveFileRef[]>;
  /** When `fileId` is given the existing Drive file is updated in place. */
  uploadJson(folderId: string, name: string, data: unknown, fileId?: string): Promise<DriveFileRef>;
  downloadJson(fileId: string): Promise<unknown>;
  moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
  searchFiles(query: string, limit?: number): Promise<DriveFileRef[]>;
}
