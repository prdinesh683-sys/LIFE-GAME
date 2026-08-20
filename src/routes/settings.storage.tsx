import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CloudUpload,
  Download,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { ConflictCard } from "@/components/app/conflict-card";
import { Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSync } from "@/lib/services/sync-store";
import { VAULT_FOLDERS, VAULT_ROOT } from "@/lib/sync/vault";
import type { SyncStatus } from "@/lib/sync/types";

export const Route = createFileRoute("/settings/storage")({
  head: () => ({
    meta: [
      { title: "Storage & Sync — Life Game" },
      {
        name: "description",
        content:
          "Connect your own Google Drive vault, sync events between devices, run verified backups, restore a save point and resolve conflicts — the local database stays the source of truth.",
      },
      { property: "og:title", content: "Storage & Sync — Life Game" },
      {
        property: "og:description",
        content: "Local-first storage with a Google Drive vault for backup, restore and multi-device sync.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StoragePage,
});

const STATUS_COPY: Record<SyncStatus, { label: string; tone: "muted" | "primary" | "spark" | "drain" }> = {
  offline: { label: "Offline — playing locally", tone: "muted" },
  not_connected: { label: "Drive not connected", tone: "muted" },
  syncing: { label: "Syncing…", tone: "primary" },
  up_to_date: { label: "Vault up to date", tone: "spark" },
  pending: { label: "Changes waiting to sync", tone: "primary" },
  error: { label: "Sync error", tone: "drain" },
  conflict: { label: "Conflicts need you", tone: "drain" },
};

function StoragePage() {
  const {
    ready,
    serverConfigured,
    state,
    conflicts,
    backups,
    driveFiles,
    pendingCount,
    busy,
    lastReport,
    message,
    driveContext,
    connect,
    disconnect,
    syncNow,
    backupNow,
    exportToDrive,
    listRestorePoints,
    restoreFromDrive,
    restoreFromJson,
    resolveConflict,
    updateSyncSettings,
    setMcpToken: rememberMcpToken,
    testMcp,
  } = useSync();

  const [restorePoints, setRestorePoints] = useState<
    { id: string; name: string; modifiedTime: string | null }[]
  >([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [mcpEndpoint, setMcpEndpoint] = useState("");
  const [mcpToken, setMcpToken] = useState("");

  useEffect(() => {
    if (state) setMcpEndpoint(state.mcpEndpoint);
  }, [state?.mcpEndpoint, state]);

  useEffect(() => {
    if (message) toast(message);
  }, [message]);

  const status = state?.status ?? "not_connected";
  const openConflicts = conflicts.filter((conflict) => conflict.status === "open");

  async function loadPoints() {
    setLoadingPoints(true);
    try {
      setRestorePoints(await listRestorePoints());
    } finally {
      setLoadingPoints(false);
    }
  }

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await restoreFromJson(await file.text());
    event.target.value = "";
  }

  return (
    <AppShell title="Storage & Sync ☁️">
      <div className="space-y-5 pb-24">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">
            This device holds the live game. Google Drive holds your vault: events, verified backups and
            exports. Nothing here is required to play.
          </p>
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">What syncs live, and what does not</p>
            <p className="mt-1">
              <span className="text-foreground">Live-synced (every device stays in step):</span> your
              quests, runs, days, boosts, drains, destinations, trophies, advice, memories, plans — plus
              the settings the game scores you against: your game setup and your
              rewards & balance. Two devices judging the same day the same way depends on that.
            </p>
            <p className="mt-1">
              <span className="text-foreground">Backup and restore only:</span> chat history,
              conversations and past AI analyses. They are historical records, not rules, so they travel
              in backups instead of live sync.
            </p>
            <p className="mt-1">
              <span className="text-foreground">Never leaves this device:</span> AI provider settings and
              keys, your device id, and theme or motion preferences.
            </p>
          </div>
        </header>


        <Panel className="space-y-4" glow={status === "conflict"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>Drive connection</SectionTitle>
            <Pill tone={STATUS_COPY[status].tone}>{STATUS_COPY[status].label}</Pill>
          </div>

          {!serverConfigured && (
            <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              Google Drive credentials are not available on this build. Everything else keeps working —
              the game stays local-first.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Account</dt>
              <dd>{state?.account ?? "not connected"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Vault folder</dt>
              <dd>{state?.rootFolderName ?? VAULT_ROOT}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Last sync</dt>
              <dd>{state?.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : "never"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Waiting to upload</dt>
              <dd className="numeric">{pendingCount}</dd>
            </div>
          </dl>

          {state?.lastSyncError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {state.lastSyncError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void connect()} disabled={!ready || busy !== null}>
              {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
              {state?.connected ? "Re-verify vault" : "Connect Google Drive"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void syncNow("manual")}
              disabled={!state?.connected || busy !== null}
            >
              {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Sync now
            </Button>
            {state?.connected && (
              <Button variant="ghost" onClick={() => void disconnect()} disabled={busy !== null}>
                <Unplug className="size-4" />
                Disconnect
              </Button>
            )}
          </div>

          {lastReport && (
            <p className="text-xs text-muted-foreground">
              Last run — uploaded {lastReport.uploaded}, applied {lastReport.applied}, duplicates skipped{" "}
              {lastReport.duplicates + lastReport.skippedDuplicateUploads}, rejected {lastReport.rejected},
              conflicts {lastReport.conflicts}, failures {lastReport.failed}.
            </p>
          )}

          <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
            Vault layout: <span className="font-mono">{state?.rootFolderName ?? VAULT_ROOT}/</span>{" "}
            {Object.values(VAULT_FOLDERS).join(" · ")} · manifest.json
          </div>
        </Panel>

        <Panel className="space-y-3">
          <SectionTitle>Automation</SectionTitle>
          <ToggleRow
            label="Sync on open, on reconnect and after each quest"
            checked={Boolean(state?.autoSync)}
            onChange={(checked) => void updateSyncSettings({ autoSync: checked })}
          />
          <ToggleRow
            label="Daily + weekly verified backups"
            checked={Boolean(state?.autoBackup)}
            onChange={(checked) => void updateSyncSettings({ autoBackup: checked })}
          />
          <ToggleRow
            label="Let the brain see Drive vault metadata (never file contents)"
            checked={Boolean(state?.driveContextEnabled)}
            onChange={(checked) => void updateSyncSettings({ driveContextEnabled: checked })}
          />
          <p className="text-xs text-muted-foreground">{driveContext.reason}</p>
        </Panel>

        <Panel className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>Backup</SectionTitle>
            <Pill tone="muted">{backups.length} recorded</Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void backupNow("manual")} disabled={!state?.connected || busy !== null}>
              {busy === "backup" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Back up now
            </Button>
            <Button
              variant="secondary"
              onClick={() => void exportToDrive()}
              disabled={!state?.connected || busy !== null}
            >
              <Download className="size-4" />
              Write export to Drive
            </Button>
          </div>
          <ul className="space-y-2 text-sm">
            {backups.slice(0, 6).map((backup) => (
              <li
                key={backup.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2"
              >
                <span>
                  <span className="font-medium">{backup.type}</span> ·{" "}
                  {new Date(backup.createdAt).toLocaleString()} · {backup.recordCount} records
                </span>
                <Pill tone={backup.verified ? "spark" : "drain"}>
                  {backup.verified ? "verified" : "unverified"}
                </Pill>
              </li>
            ))}
            {!backups.length && (
              <li className="text-sm text-muted-foreground">No backups yet.</li>
            )}
          </ul>
        </Panel>

        <Panel className="space-y-3">
          <SectionTitle>Restore</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Restoring replaces local data. A safety copy of the current state is written to this device
            first, and any file that fails its checksum is refused.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void loadPoints()}
              disabled={!state?.connected || loadingPoints}
            >
              {loadingPoints ? <Loader2 className="size-4 animate-spin" /> : <HardDriveDownload className="size-4" />}
              List restore points
            </Button>
            <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
              Restore from file
              <input type="file" accept="application/json" className="hidden" onChange={onPickFile} />
            </Label>
          </div>
          <ul className="space-y-2 text-sm">
            {restorePoints.slice(0, 10).map((point) => (
              <li
                key={point.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2"
              >
                <span className="truncate font-mono text-xs">{point.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void restoreFromDrive(point.id)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="space-y-3" glow={openConflicts.length > 0}>
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>Conflicts</SectionTitle>
            <Pill tone={openConflicts.length ? "drain" : "muted"}>{openConflicts.length} open</Pill>
          </div>
          {!conflicts.length && (
            <p className="text-sm text-muted-foreground">
              No conflicts. Two devices editing the same thing between syncs will show up here for you to
              decide — nothing is silently overwritten.
            </p>
          )}
          {conflicts.slice(0, 8).map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              busy={busy !== null}
              onResolve={(resolution) => void resolveConflict(conflict.id, resolution)}
            />
          ))}
        </Panel>

        <Panel className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>Drive MCP boundary</SectionTitle>
            <Pill tone={state?.mcpStatus === "configured" ? "spark" : "muted"}>
              {state?.mcpStatus ?? "not_configured"}
            </Pill>
          </div>
          <p className="text-xs text-muted-foreground">
            Optional. If you run a Google Drive MCP server, the brain can read through it. Sync never
            depends on MCP, and the status below reflects a real handshake — not a guess.
          </p>
          <div className="space-y-2">
            <Label htmlFor="mcp-endpoint">MCP endpoint</Label>
            <Input
              id="mcp-endpoint"
              value={mcpEndpoint}
              placeholder="https://your-mcp-host/mcp"
              onChange={(event) => setMcpEndpoint(event.target.value)}
            />
            <Label htmlFor="mcp-token">Token (optional)</Label>
            <Input
              id="mcp-token"
              type="password"
              value={mcpToken}
              onChange={(event) => setMcpToken(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={async () => {
                rememberMcpToken(mcpToken);
                await updateSyncSettings({ mcpEndpoint });
                await testMcp();
              }}
            >
              {busy === "mcp" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Save &amp; test
            </Button>
          </div>
          {state?.mcpDetail && <p className="text-xs text-muted-foreground">{state.mcpDetail}</p>}
        </Panel>

        <Panel className="space-y-2">
          <SectionTitle>Drive inventory</SectionTitle>
          <p className="text-xs text-muted-foreground">
            {driveFiles.length} vault files tracked on this device.
          </p>
          <ul className="space-y-1 text-xs">
            {driveFiles.slice(0, 12).map((file) => (
              <li key={file.id} className="flex justify-between gap-2 font-mono">
                <span className="truncate">{file.name}</span>
                <span className="text-muted-foreground">{file.folder}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
