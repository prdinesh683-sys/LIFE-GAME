import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "./primitives";
import type { CompletionResult } from "@/lib/services/game-store";

export function RewardDialog({
  result,
  onClose,
}: {
  result: CompletionResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={result !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="bg-surface text-center">
        <DialogTitle className="sr-only">Quest complete</DialogTitle>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          Quest complete
        </p>
        <p className="numeric mt-2 flex items-center justify-center gap-2 text-5xl font-bold text-spark">
          <Sparkles className="size-8" />+{result?.sparks ?? 0}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {result?.combo && result.combo > 1 ? (
            <Pill tone="spark">Combo x{result.combo}</Pill>
          ) : null}
          {result?.surge ? <Pill tone="accent">⚡ Surge bonus</Pill> : null}
          {result?.rankUp ? <Pill tone="primary">Rank {result.rank} reached</Pill> : null}
          {result?.runMilestone ? (
            <Pill tone="primary">{result.runMilestone}-day Run 🔥</Pill>
          ) : null}
        </div>
        {result?.trophy ? (
          <p className="mt-4 text-sm">
            {result.trophy.icon} <span className="font-semibold">{result.trophy.name}</span>
            <span className="block text-muted-foreground">{result.trophy.description}</span>
          </p>
        ) : null}
        <p className="mt-5 text-sm text-muted-foreground">
          Now put the device away and get back to your life.
        </p>
        <Button className="mt-4" onClick={onClose}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}