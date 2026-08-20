import {
  driveDeleteFile,
  driveDownloadJson,
  driveEnsureFolder,
  driveListFiles,
  driveMoveFile,
  driveSearchFiles,
  driveUploadJson,
  driveVerify,
} from "@/lib/drive.functions";
import { DriveError, driveErrorFromStatus, type DriveFileRef, type DriveProvider } from "./drive-provider";

/** Server-function errors arrive as `DRIVE_<status>:<body>` — map them back. */
function mapError(error: unknown): DriveError {
  if (error instanceof DriveError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const match = /^DRIVE_(\d{3}):([\s\S]*)$/.exec(message);
  if (match) return driveErrorFromStatus(Number(match[1]), match[2] ?? "");
  if (/not connected/i.test(message)) return new DriveError("auth", message);
  if (/fetch|network|Failed to fetch/i.test(message)) return new DriveError("network", message);
  return new DriveError("unknown", message);
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw mapError(error);
  }
}

export class GoogleDriveProvider implements DriveProvider {
  readonly kind = "google-drive";

  verify() {
    return guard(async () => {
      const result = await driveVerify();
      return { account: result.account };
    });
  }

  ensureFolder(name: string, parentId: string | null) {
    return guard(async () => (await driveEnsureFolder({ data: { name, parentId } })).id);
  }

  listFiles(folderId: string): Promise<DriveFileRef[]> {
    return guard(async () => (await driveListFiles({ data: { folderId } })).files);
  }

  uploadJson(folderId: string, name: string, data: unknown, fileId?: string): Promise<DriveFileRef> {
    return guard(
      async () =>
        (
          await driveUploadJson({
            data: { folderId, name, content: JSON.stringify(data, null, 2), ...(fileId ? { fileId } : {}) },
          })
        ).file,
    );
  }

  downloadJson(fileId: string): Promise<unknown> {
    return guard(async () => {
      const { content } = await driveDownloadJson({ data: { fileId } });
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new DriveError("invalid", "Drive file is not valid JSON");
      }
    });
  }

  moveFile(fileId: string, fromFolderId: string, toFolderId: string): Promise<void> {
    return guard(async () => {
      await driveMoveFile({ data: { fileId, fromFolderId, toFolderId } });
    });
  }

  deleteFile(fileId: string): Promise<void> {
    return guard(async () => {
      await driveDeleteFile({ data: { fileId } });
    });
  }

  searchFiles(query: string, limit = 20): Promise<DriveFileRef[]> {
    return guard(async () => (await driveSearchFiles({ data: { query, limit } })).files);
  }
}
