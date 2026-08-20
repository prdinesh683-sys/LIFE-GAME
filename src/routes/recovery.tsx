import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { generateNextMoves, optionToDraft } from "@/lib/game/recommendation-engine";
import { useGame } from "@/lib/services/game-store";
import { useAi } from "@/lib/services/ai-store";
import { Brain } from "lucide-react";
import type { BehaviorAnalysisResponse } from "@/lib/ai/schemas";

export const Route = createFileRoute("/recovery")({
  head: () => ({
    meta: [
      { title: "Recovery — Life Game" },
      {
        name: "description",
        content:
          "A no-shame comeback path: one tiny action that restarts your Momentum after a gap or a miss.",
      },
      { property: "og:title", content: "Recovery — Life Game" },
      {
        property: "og:description",
        content: "A no-shame comeback: one tiny action to restart your Momentum.",
      },
    ],
  }),
  component: RecoveryPage,
});

function RecoveryPage() {
  const { snapshot, today, momentum, needsRecovery, createQuest, startQuest } = useGame();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const option = useMemo(() => {
    if (!snapshot) return null;
    const moves = generateNextMoves({
      config: snapshot.settings.economy,
      boosts: snapshot.boosts,
      destinations: snapshot.destinations,
      runs: snapshot.questRuns,
      today,
      momentum: momentum.value,
      blueprint: snapshot.blueprint,
      needsRecovery: true,
      seed: 0,
    });
    return moves.find((m) => m.isRecovery) ?? moves[0] ?? null;
  }, [snapshot, today, momentum.value]);

  const ai = useAi();
  const [analysis, setAnalysis] = useState<{
    data: BehaviorAnalysisResponse;
    source: "ai" | "engine";
    brain: string | null;
  } | null>(null);

  const runAnalysis = async () => {
    const outcome = await ai.analyzeBehavior();
    setAnalysis({ data: outcome.value, source: outcome.source, brain: outcome.brain });
  };

  if (!snapshot) return <AppShell title="Recovery">{null}</AppShell>;

  return (
    <AppShell title="Recovery 🛟" subtitle="Comeback, not catch-up">
      <div className="space-y-4">
        <Panel glow>
          <Pill tone={needsRecovery ? "accent" : "primary"}>
            {needsRecovery ? "Momentum is low" : "Momentum is holding"}
          </Pill>
          <h2 className="mt-3 font-display text-xl font-semibold leading-snug">
            Nothing to make up for.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            There is no debt in this game. One small real action restarts everything — your Run
            grace period and your Momentum both respond to the next thing you actually do.
          </p>
        </Panel>

        {option ? (
          <Panel>
            <SectionTitle>Smallest useful move</SectionTitle>
            <p className="font-display text-lg font-semibold">{option.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{option.reason}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill>{option.durationMinutes}m</Pill>
              <Pill tone="spark">{option.sparks} Sparks</Pill>
            </div>
            <Button
              size="lg"
              className="mt-4 w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const quest = await createQuest(optionToDraft({ ...option, isRecovery: true }));
                  await startQuest(quest.id);
                  toast.success("Comeback started.");
                  await navigate({ to: "/" });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not start it");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Start the comeback
            </Button>
          </Panel>
        ) : null}

        <Panel className="space-y-3">
          <SectionTitle
            action={
              analysis ? (
                <Pill tone={analysis.source === "ai" ? "primary" : "muted"}>
                  {analysis.source === "ai" ? (analysis.brain ?? "AI") : "Local engine"}
                </Pill>
              ) : null
            }
          >
            Behavioral read
          </SectionTitle>
          {analysis ? (
            <div className="space-y-3 text-sm">
              {(
                [
                  ["Confirmed", analysis.data.confirmed_facts],
                  ["Patterns", analysis.data.observed_patterns],
                  ["Hypotheses", analysis.data.hypotheses],
                  ["Likely drains", analysis.data.possible_drains],
                  ["What works", analysis.data.successful_boosts],
                  ["Experiments to try", analysis.data.recommended_experiments],
                ] as const
              )
                .filter(([, items]) => items.length > 0)
                .map(([label, items]) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                    <ul className="mt-1 space-y-1">
                      {items.map((item) => (
                        <li key={item} className="text-muted-foreground">
                          · {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              <p className="text-[11px] text-muted-foreground">
                Nothing here changes your state until you approve it. Confidence: {analysis.data.confidence}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask for a read on your last weeks: what held, what slipped, and what to test next.
            </p>
          )}
          <Button
            variant="outline"
            className="w-full"
            disabled={ai.thinking}
            onClick={() => void runAnalysis()}
          >
            <Brain className="mr-1 size-4" />
            {ai.thinking ? "Thinking…" : analysis ? "Re-analyze" : "Analyze my patterns"}
          </Button>
        </Panel>

        <Panel>
          <SectionTitle>Why you missed things</SectionTitle>
          <p className="text-sm text-muted-foreground">
            Recorded reasons stay visible so the system can adapt instead of nagging.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {snapshot.questRuns
              .filter((r) => r.outcome === "missed")
              .slice(0, 8)
              .map((run) => (
                <li key={run.id} className="rounded-md border border-border/60 bg-background/40 p-2">
                  <span className="font-medium">{run.questName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {run.missNote || run.missReason || "no reason recorded"}
                  </span>
                </li>
              ))}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}