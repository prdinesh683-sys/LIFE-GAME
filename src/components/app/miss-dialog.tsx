import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MISS_REASON_LABELS, type MissReason } from "@/lib/game/types";
import type { RecoveryChoice, RecoveryKind } from "@/lib/game/miss-recovery";

/**
 * No shame, no lecture — a miss is only ever data.
 * Phase 6A adds one optional step after it: a way back, never a requirement.
 */
export function MissDialog({
  open,
  onOpenChange,
  onSubmit,
  recoveryChoices = [],
  onRecover,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: MissReason, note: string) => void;
  recoveryChoices?: RecoveryChoice[];
  onRecover?: (kind: RecoveryKind) => void;
}) {
  const [reason, setReason] = useState<MissReason>("distracted");
  const [note, setNote] = useState("");
  const [recovering, setRecovering] = useState(false);

  const close = () => {
    setRecovering(false);
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setRecovering(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-surface">
        {recovering ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">Want a way back?</DialogTitle>
              <DialogDescription>
                Recorded. You can pick one of these, or just close this — nothing is required.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {recoveryChoices.map((choice) => (
                <button
                  key={choice.kind}
                  type="button"
                  onClick={() => {
                    onRecover?.(choice.kind);
                    close();
                  }}
                  className="w-full rounded-md border border-border bg-background/40 px-3 py-2.5 text-left transition-colors hover:border-primary hover:text-primary"
                >
                  <span className="block text-sm font-medium">{choice.label}</span>
                  <span className="block text-xs text-muted-foreground">{choice.detail}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={close}>
              Not now
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">What got in the way?</DialogTitle>
              <DialogDescription>
                This isn't a failure — it's the data the system adapts with.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MISS_REASON_LABELS) as MissReason[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReason(key)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                    reason === key
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {MISS_REASON_LABELS[key]}
                </button>
              ))}
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Anything else worth remembering? (optional)"
              className="bg-background/50"
            />
            <Button
              onClick={() => {
                onSubmit(reason, note.trim());
                setNote("");
                if (recoveryChoices.length && onRecover) setRecovering(true);
              }}
            >
              Record it
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
