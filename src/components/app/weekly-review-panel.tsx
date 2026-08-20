import { ChevronDown, CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";

import { buildWeeklyReview } from "@/lib/game/weekly-review";
import { followThroughByWindow } from "@/lib/memory/follow-through";
import { detectPatternCandidates } from "@/lib/memory/pattern-engine";
import { useAdvisor } from "@/lib/services/advisor-store";
import { useGame } from "@/lib/services/game-store";
import { Panel, SectionTitle } from "./primitives";

/**
 * Lightweight weekly review (Phase 5, item 8). Deterministic, plain language,
 * and collapsed by default — this is a short story, not a dashboard.
 */
export function WeeklyReviewPanel() {
  const { snapshot } = useGame();
  const advisor = useAdvisor();
  const [open, setOpen] = useState(false);

  const review = useMemo(() => {
    if (!snapshot) return null;
    const week = Date.now() - 7 * 86_400_000;
    const decided = advisor.past.filter((r) => r.decidedAt && Date.parse(r.decidedAt) >= week);
    return buildWeeklyReview({
      runs: snapshot.questRuns,
      accepted: decided.filter((r) => r.status === "applied").length,
      rejected: decided.filter((r) => r.status === "rejected").length,
    });
  }, [snapshot, advisor.past]);

  // Phase 6B: one compact learning line, from the existing pattern candidates.
  const followThrough = useMemo(
    () =>
      followThroughByWindow(
        snapshot ? detectPatternCandidates(snapshot.questRuns, snapshot.events) : [],
      ),
    [snapshot],
  );

  if (!review || !review.hasEvidence) return null;

  return (
    <Panel className="space-y-2">
      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {open ? "Hide" : "Show"}
            <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        }
      >
        Your week
      </SectionTitle>
      <p className="flex items-center gap-2 text-sm">
        <CalendarRange className="size-4 text-primary" />
        {review.completed} finished · {review.missed} missed · {review.accepted} suggestions taken
      </p>
      <p data-testid="weekly-follow-through" className="text-xs text-muted-foreground">
        {followThrough.headline}
      </p>
      {open ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          {review.worked.length ? (
            <Block title="What worked" lines={review.worked} />
          ) : null}
          {review.didNotWork.length ? (
            <Block title="What didn't" lines={review.didNotWork} />
          ) : null}
          {review.learned.length ? (
            <Block title="What I learned about you" lines={review.learned} />
          ) : null}
          <p className="rounded-md border border-border/60 bg-background/40 p-2 text-foreground">
            One adjustment: {review.adjustment}
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

function Block({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div>
      <p className="font-medium text-foreground">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {lines.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
    </div>
  );
}
