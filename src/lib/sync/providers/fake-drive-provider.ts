import { DriveError, type DriveFileRef, type DriveProvider } from "./drive-provider";

interface FakeFile {
  id: string;
  name: string;
  folderId: string;
  content: unknown;
  modifiedTime: string;
}

/**
 * In-memory DriveProvider used by tests and offline drills. Supports forced
 * failures so the engines can be exercised against real error paths.
 */
export class FakeDriveProvider implements DriveProvider {
  readonly kind = "fake-drive";
  private folders = new Map<string, { name: string; parentId: string | null }>();
  private files = new Map<string, FakeFile>();
  private counter = 0;
  failNext: DriveError | null = null;
  offline = false;
  readonly calls: string[] = [];

  constructor(private readonly account = "tester@example.com") {}

  private nextId(prefix: string) {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private check(op: string) {
    this.calls.push(op);
    if (this.offline) throw new DriveError("network", "Fake drive is offline");
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  async verify() {
    this.check("verify");
    return { account: this.account };
  }

  async ensureFolder(name: string, parentId: string | null) {
    this.check(`ensureFolder:${name}`);
    for (const [id, folder] of this.folders) {
      if (folder.name === name && folder.parentId === parentId) return id;
    }
    const id = this.nextId("folder");
    this.folders.set(id, { name, parentId });
    return id;
  }

  async listFiles(folderId: string): Promise<DriveFileRef[]> {
    this.check(`listFiles:${folderId}`);
    return [...this.files.values()]
      .filter((file) => file.folderId === folderId)
      .map((file) => this.toRef(file));
  }

  async uploadJson(folderId: string, name: string, data: unknown, fileId?: string): Promise<DriveFileRef> {
    this.check(`uploadJson:${name}`);
    const existing = fileId
      ? this.files.get(fileId)
      : [...this.files.values()].find((file) => file.folderId === folderId && file.name === name);
    const file: FakeFile = existing
      ? { ...existing, content: data, modifiedTime: new Date().toISOString() }
      : {
          id: this.nextId("file"),
          name,
          folderId,
          content: data,
          modifiedTime: new Date().toISOString(),
        };
    this.files.set(file.id, file);
    return this.toRef(file);
  }

  async downloadJson(fileId: string): Promise<unknown> {
    this.check(`downloadJson:${fileId}`);
    const file = this.files.get(fileId);
    if (!file) throw new DriveError("not_found", "Fake drive file missing");
    return JSON.parse(JSON.stringify(file.content)) as unknown;
  }

  async moveFile(fileId: string, _fromFolderId: string, toFolderId: string): Promise<void> {
    this.check(`moveFile:${fileId}`);
    const file = this.files.get(fileId);
    if (!file) throw new DriveError("not_found", "Fake drive file missing");
    this.files.set(fileId, { ...file, folderId: toFolderId });
  }

  async deleteFile(fileId: string): Promise<void> {
    this.check(`deleteFile:${fileId}`);
    this.files.delete(fileId);
  }

  async searchFiles(query: string, limit = 20): Promise<DriveFileRef[]> {
    this.check(`searchFiles:${query}`);
    const needle = /name contains '([^']*)'/.exec(query)?.[1]?.toLowerCase() ?? "";
    return [...this.files.values()]
      .filter((file) => file.name.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((file) => this.toRef(file));
  }

  /** Test helper: seed a remote file as if another device wrote it. */
  seed(folderId: string, name: string, content: unknown) {
    const id = this.nextId("file");
    this.files.set(id, { id, name, folderId, content, modifiedTime: new Date().toISOString() });
    return id;
  }

  private toRef(file: FakeFile): DriveFileRef {
    return {
      id: file.id,
      name: file.name,
      mimeType: "application/json",
      sizeBytes: JSON.stringify(file.content).length,
      modifiedTime: file.modifiedTime,
    };
  }
}
