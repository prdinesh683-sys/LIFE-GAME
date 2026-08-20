import { ArrowUpRight, Sparkles } from "lucide-react";

import { useGame } from "@/lib/services/game-store";
import { useAdvisor } from "@/lib/services/advisor-store";
import { Panel, Pill, SectionTitle } from "./primitives";

/**
 * Visible outcome loop (Phase 5, item 7/30).
 *
 * After a real action the player should not have to open History to find out
 * what changed. This reads records that already exist — the last finished run
 * and, when present, the measured outcome of the recommendation behind it.
 */
export function OutcomeSummary() {
  const { snapshot, momentum } = useGame();
  const advisor = useAdvisor();

  if (!snapshot) return null;

  const last = [...snapshot.questRuns]
    .filter((r) => r.outcome !== "in_progress")
    .sort((a, b) => Date.parse(b.endedAt ?? b.startedAt) - Date.parse(a.endedAt ?? a.startedAt))[0];

  if (!last) return null;

  const momentumDelta =
    last.momentumAtStart != null ? Math.round(momentum.value - last.momentumAtStart) : null;

  const linkedOutcome =
    advisor.outcomes.find((o) => advisor.past.some((r) => r.id === o.recommendationId && r.questId === last.questId)) ??
    null;

  return (
    <Panel className="space-y-2">
      <SectionTitle>What changed</SectionTitle>
      <p className="text-sm font-medium">
        {last.outcome === "completed"
          ? `You completed ${last.questName}`
          : `You logged a miss on ${last.questName}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {last.outcome === "completed" && last.sparksAwarded > 0 ? (
          <Pill tone="spark">
            <Sparkles className="mr-1 inline size-3" />+{last.sparksAwarded} Sparks
          </Pill>
        ) : null}
        {momentumDelta != null && momentumDelta !== 0 ? (
          <Pill tone={momentumDelta > 0 ? "primary" : "muted"}>
            <ArrowUpRight className="mr-1 inline size-3" />
            Momentum {momentumDelta > 0 ? "improved" : "dipped"} ({momentumDelta > 0 ? "+" : ""}
            {momentumDelta})
          </Pill>
        ) : null}
        <Pill tone="muted">Run {snapshot.profile.currentRun}d</Pill>
      </div>
      {linkedOutcome ? (
        <p className="text-xs text-muted-foreground">{linkedOutcome.note}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {last.outcome === "completed"
            ? "That's the loop working: real action, real change."
            : "A miss is data, not a failure. The next one can be smaller."}
        </p>
      )}
    </Panel>
  );
}
