import { AlertTriangle } from "lucide-react";

import { Panel, Pill } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import type { ConflictRecord, ConflictResolution } from "@/lib/sync/types";

function preview(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 90 ? `${value.slice(0, 90)}…` : value;
  const text = JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

export function ConflictCard({
  conflict,
  onResolve,
  busy,
}: {
  conflict: ConflictRecord;
  onResolve: (resolution: ConflictResolution) => void;
  busy?: boolean;
}) {
  const resolved = conflict.status === "resolved";
  return (
    <Panel className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 text-primary" aria-hidden />
            {conflict.entityLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            {conflict.entityStore} · {conflict.field ?? "whole record"} · detected{" "}
            {new Date(conflict.detectedAt).toLocaleString()}
          </p>
        </div>
        <Pill tone={resolved ? "muted" : "drain"}>{resolved ? conflict.resolution : "needs you"}</Pill>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-md border border-border/60 p-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">This device</p>
          <p className="break-words">{preview(conflict.localValue)}</p>
        </div>
        <div className="rounded-md border border-border/60 p-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Other device ({conflict.remoteDeviceId.slice(0, 12)}…)
          </p>
          <p className="break-words">{preview(conflict.remoteValue)}</p>
        </div>
      </div>

      {!resolved && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => onResolve("keep_local")}>
            Keep this device
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onResolve("keep_remote")}>
            Keep other device
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve("merge")}>
            Merge
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onResolve("review_later")}>
            Decide later
          </Button>
        </div>
      )}
    </Panel>
  );
}
