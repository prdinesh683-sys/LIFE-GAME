import { useMemo } from "react";

import {
  applyRephrase,
  selectBecause,
  type BecauseReason,
  type OutcomeEvidence,
} from "@/lib/advisor/because";
import { detectPatternCandidates } from "@/lib/memory/pattern-engine";
import type { TimeWindow } from "@/lib/game/time-window";
import { useAdvisor } from "@/lib/services/advisor-store";
import { useGame } from "@/lib/services/game-store";

/**
 * PHASE 6B — one shared "because…" line.
 *
 * Every surface that shows a reason calls this hook, so Today, the Advisor
 * card and a quest card can never disagree: it is the same deterministic
 * selection, not a second calculation.
 */
export function useBecause(input: {
  questName?: string | null;
  slot?: TimeWindow | null;
  shape?: string | null;
  /** Optional AI rephrasing of the deterministic sentence. */
  rephrased?: string | null;
}): BecauseReason & { text: string } {
  const { snapshot } = useGame();
  const advisor = useAdvisor();
  const { questName = null, slot = null, shape = null, rephrased = null } = input;

  const patterns = useMemo(
    () => (snapshot ? detectPatternCandidates(snapshot.questRuns, snapshot.events) : []),
    [snapshot],
  );

  const outcomes = useMemo<OutcomeEvidence[]>(() => {
    const byId = new Map([...advisor.live, ...advisor.past].map((r) => [r.id, r]));
    return advisor.outcomes.map((outcome) => ({
      recommendationId: outcome.recommendationId,
      shape: byId.get(outcome.recommendationId)?.action.type ?? "none",
      result: outcome.result,
      measuredAt: outcome.measuredAt,
    }));
  }, [advisor.outcomes, advisor.live, advisor.past]);

  const facts = useMemo(() => {
    const list: string[] = [];
    const f = advisor.facts;
    if (!f) return list;
    if (f.completionsToday > 0) {
      list.push(
        `you've already finished ${f.completionsToday} thing${f.completionsToday === 1 ? "" : "s"} today`,
      );
    }
    if (f.availableMinutes != null) list.push(`you have about ${f.availableMinutes} minutes today`);
    if (f.energy != null) list.push(`your energy today is ${f.energy} out of 5`);
    return list;
  }, [advisor.facts]);

  return useMemo(() => {
    const reason = selectBecause({
      patterns,
      outcomes,
      shape,
      questName,
      slot,
      stated: snapshot?.blueprint
        ? {
            priorities: snapshot.blueprint.priorities,
            goals: snapshot.blueprint.goals,
            constraints: snapshot.blueprint.constraints,
          }
        : null,
      facts,
    });
    // AI may only rephrase; a rephrase that drops the evidence is rejected.
    return { ...reason, text: applyRephrase(reason, rephrased) };
  }, [patterns, outcomes, shape, questName, slot, snapshot?.blueprint, facts, rephrased]);
}

/** One short plain line. No ids, no confidence internals, no jargon. */
export function BecauseLine({
  reason,
  className = "",
}: {
  reason: BecauseReason & { text: string };
  className?: string;
}) {
  return (
    <p
      data-testid="because-line"
      className={`text-xs ${reason.sufficient ? "text-muted-foreground" : "italic text-muted-foreground/80"} ${className}`}
    >
      {reason.text}
    </p>
  );
}
