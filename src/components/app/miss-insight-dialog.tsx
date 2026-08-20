import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pill } from "./primitives";
import type { MissAnalysisResponse } from "@/lib/ai/schemas";

export interface MissInsight {
  data: MissAnalysisResponse;
  source: "ai" | "engine";
  brain: string | null;
}

/** Reads a miss back as learning data. Nothing here changes state on its own. */
export function MissInsightDialog({
  insight,
  onClose,
}: {
  insight: MissInsight | null;
  onClose: () => void;
}) {
  const data = insight?.data;
  const groups: ReadonlyArray<readonly [string, string[]]> = data
    ? ([
        ["Supporting facts", data.supporting_facts],
        ["Hypotheses", data.hypotheses],
      ] as ReadonlyArray<readonly [string, string[]]>).filter(([, items]) => items.length > 0)
    : [];

  return (
    <Dialog open={insight !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface">
        <DialogHeader>
          <DialogTitle className="font-display">What this miss tells us</DialogTitle>
          <DialogDescription>
            Data, not judgement. Nothing changes until you choose it.
          </DialogDescription>
        </DialogHeader>
        {insight ? (
          <div className="space-y-3 text-sm">
            <Pill tone={insight.source === "ai" ? "primary" : "muted"}>
              {insight.source === "ai" ? (insight.brain ?? "AI") : "Local engine"}
            </Pill>
            {groups.map(([label, items]) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {items.map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </div>
            ))}
            {data ? (
              <>
                <p className="text-foreground">{data.likely_reason}</p>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Smallest comeback
                  </p>
                  <p className="text-muted-foreground">
                    {data.recommended_recovery.title} · {Math.round(data.recommended_recovery.duration_minutes)}m
                  </p>
                </div>
                {data.proposed_adjustment ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Proposed adjustment
                    </p>
                    <p className="text-muted-foreground">{data.proposed_adjustment}</p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        <Button onClick={onClose}>Back to real life</Button>
      </DialogContent>
    </Dialog>
  );
}
