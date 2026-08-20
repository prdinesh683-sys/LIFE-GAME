import type { DriveFileRecord } from "./types";

/**
 * Controlled AI access to Drive data.
 *
 * The AI never receives raw vault contents. It receives a short, redacted
 * inventory only when the player has explicitly enabled Drive context.
 */

export interface DriveContextInput {
  enabled: boolean;
  connected: boolean;
  account: string | null;
  files: DriveFileRecord[];
  lastSyncAt: string | null;
  lastBackupAt: string | null;
  openConflicts: number;
}

export interface DriveContextBlock {
  allowed: boolean;
  reason: string;
  text: string;
}

const ALLOWED_KINDS: DriveFileRecord["kind"][] = ["backup", "export", "snapshot", "manifest"];

export function buildDriveContext(input: DriveContextInput): DriveContextBlock {
  if (!input.enabled) {
    return {
      allowed: false,
      reason: "Drive context is switched off. The brain sees local game data only.",
      text: "",
    };
  }
  if (!input.connected) {
    return { allowed: false, reason: "Google Drive is not connected.", text: "" };
  }

  const inventory = input.files
    .filter((file) => ALLOWED_KINDS.includes(file.kind))
    .slice(0, 12)
    .map((file) => `- ${file.kind}: ${redactName(file.name)} (${file.modifiedTime ?? "unknown date"})`);

  const lines = [
    "DRIVE VAULT (metadata only — file contents are not shared):",
    `account: ${maskAccount(input.account)}`,
    `last sync: ${input.lastSyncAt ?? "never"}`,
    `last backup: ${input.lastBackupAt ?? "never"}`,
    `open conflicts: ${input.openConflicts}`,
    inventory.length ? "recent vault artifacts:" : "recent vault artifacts: none",
    ...inventory,
  ];

  return { allowed: true, reason: "Drive metadata shared with the brain.", text: lines.join("\n") };
}

export function maskAccount(account: string | null): string {
  if (!account) return "unknown";
  const [name, domain] = account.split("@");
  if (!domain || !name) return "connected account";
  return `${name.slice(0, 2)}***@${domain}`;
}

export function redactName(name: string): string {
  return name.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, "<id>");
}
