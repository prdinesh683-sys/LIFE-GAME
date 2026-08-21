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
    <AppShell title="Recovery" subtitle="Welcome back">
      <div className="space-y-6">
        <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-surface-raised/60 to-surface/40 p-6">
          <div className="flex items-center gap-2">
            <Pill tone={needsRecovery ? "primary" : "focus"}>
              {needsRecovery ? "Momentum in Reset Window" : "Momentum Steady"}
            </Pill>
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground">
            Welcome back.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            Life moved. That's completely okay. There is no debt or penalty here — one small action restarts your momentum immediately.
          </p>
        </div>

        {option ? (
          <div className="rounded-2xl border border-primary/30 bg-surface/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Let's take one small step</span>
              <span className="text-xs text-muted-foreground">{option.durationMinutes} min</span>
            </div>
            <h3 className="mt-3 font-display text-xl font-bold tracking-tight text-foreground">{option.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{option.reason}</p>
            <Button
              size="lg"
              className="mt-5 w-full text-base font-semibold"
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
              Start comeback ({option.durationMinutes}m)
            </Button>
          </div>
        ) : null}

        <div className="space-y-3">
          <SectionTitle
            action={
              analysis ? (
                <Pill tone={analysis.source === "ai" ? "accent" : "muted"}>
                  {analysis.source === "ai" ? (analysis.brain ?? "AI") : "Local engine"}
                </Pill>
              ) : null
            }
          >
            Reflective Insights
          </SectionTitle>
          {analysis ? (
            <div className="space-y-3.5 text-sm">
              {(
                [
                  ["Confirmed Facts", analysis.data.confirmed_facts],
                  ["Observed Patterns", analysis.data.observed_patterns],
                  ["Hypotheses", analysis.data.hypotheses],
                  ["Possible Drains", analysis.data.possible_drains],
                  ["Successful Boosts", analysis.data.successful_boosts],
                  ["Recommended Experiments", analysis.data.recommended_experiments],
                ] as const
              )
                .filter(([, items]) => items.length > 0)
                .map(([label, items]) => (
                  <div key={label} className="rounded-lg border border-border/50 bg-background/50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">{label}</p>
                    <ul className="mt-1.5 space-y-1">
                      {items.map((item) => (
                        <li key={item} className="text-xs text-muted-foreground">
                          • {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              <p className="text-[11px] text-muted-foreground/80">
                Nothing here modifies your game state until you approve it.
              </p>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Request a behavioral read on your recent days to see what held, what drained energy, and what micro-experiment to test next.
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs font-semibold"
            disabled={ai.thinking}
            onClick={() => void runAnalysis()}
          >
            <Brain className="mr-1.5 size-3.5" />
            {ai.thinking ? "Analyzing behavior…" : "Ask for a behavioral read"}
          </Button>
        </div>

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