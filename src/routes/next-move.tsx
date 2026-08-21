import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Brain, RefreshCw, Sparkles, Timer, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { CurrentStateBar } from "@/components/app/current-state-bar";
import { Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { optionToDraft, generateNextMoves, type NextMoveOption } from "@/lib/game/recommendation-engine";
import { ATTRIBUTE_LABELS } from "@/lib/game/types";
import { useGame } from "@/lib/services/game-store";
import { useAi } from "@/lib/services/ai-store";
import { BrainChip } from "@/components/app/brain-chip";
import type { NextMoveResponse } from "@/lib/ai/schemas";

export const Route = createFileRoute("/next-move")({
  head: () => ({
    meta: [
      { title: "Next Move — Life Game" },
      {
        name: "description",
        content:
          "One tap turns your current energy, mood and free time into a single real-world action worth doing right now.",
      },
      { property: "og:title", content: "Next Move — Life Game" },
      {
        property: "og:description",
        content: "Turn your current state into one real action worth doing right now.",
      },
    ],
  }),
  component: NextMovePage,
});

function NextMovePage() {
  const { snapshot, momentum, today, needsRecovery, activeRun, createQuest, startQuest } = useGame();
  const navigate = useNavigate();
  const [seed, setSeed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const ai = useAi();
  const [aiMoves, setAiMoves] = useState<{ data: NextMoveResponse; source: "ai" | "engine"; brain: string | null } | null>(
    null,
  );

  /** AI proposes moves; the deterministic engine still builds and validates the quest. */
  const askBrain = async () => {
    const outcome = await ai.suggestNextMoves();
    setAiMoves({ data: outcome.value, source: outcome.source, brain: outcome.brain });
    if (outcome.note) toast.info(outcome.note);
  };

  const acceptAiMove = async (move: NextMoveResponse["recommendations"][number]) => {
    setBusy(move.title);
    try {
      const quest = await createQuest({
        name: move.title,
        description: move.reason,
        durationMinutes: Math.max(5, Math.round(move.duration_minutes)),
        difficulty: move.difficulty,
        isRecovery: move.is_recovery,
        createdBy: aiMoves?.source === "ai" ? "ai" : "engine",
        aiGenerated: aiMoves?.source === "ai",
      });
      await startQuest(quest.id, { rushRequested: move.rush });
      toast.success("Quest started. Put the device away.");
      await navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start that quest");
    } finally {
      setBusy(null);
    }
  };

  const options = useMemo<NextMoveOption[]>(() => {
    if (!snapshot) return [];
    return generateNextMoves({
      config: snapshot.settings.economy,
      boosts: snapshot.boosts,
      destinations: snapshot.destinations,
      runs: snapshot.questRuns,
      today,
      momentum: momentum.value,
      blueprint: snapshot.blueprint,
      needsRecovery,
      seed,
    });
  }, [snapshot, today, momentum.value, needsRecovery, seed]);

  const accept = async (option: NextMoveOption) => {
    setBusy(option.id);
    try {
      const quest = await createQuest(optionToDraft(option));
      await startQuest(quest.id, { rushRequested: option.rush });
      toast.success("Quest started. Put the device away.");
      await navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start that quest");
    } finally {
      setBusy(null);
    }
  };

  const [primary, ...alternatives] = options;

  return (
    <AppShell title="Next Move ⚡" subtitle="One action, right now">
      <div className="space-y-4">
        {activeRun ? (
          <Panel>
            <p className="text-sm text-muted-foreground">
              A quest is already running. Finish or release it from Home before taking a new move.
            </p>
            <Button className="mt-3 w-full" onClick={() => void navigate({ to: "/" })}>
              Back to the active quest
            </Button>
          </Panel>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <BrainChip />
          <Button size="sm" variant="outline" disabled={ai.thinking} onClick={() => void askBrain()}>
            <Brain className="mr-1 size-4" />
            {ai.thinking ? "Thinking…" : "Ask the brain"}
          </Button>
        </div>

        {aiMoves ? (
          <Panel className="space-y-3">
            <SectionTitle
              action={
                <Pill tone={aiMoves.source === "ai" ? "primary" : "muted"}>
                  {aiMoves.source === "ai" ? (aiMoves.brain ?? "AI") : "Local engine"}
                </Pill>
              }
            >
              Proposed moves
            </SectionTitle>
            {aiMoves.data.recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing proposed. The engine list below still stands.</p>
            ) : null}
            {aiMoves.data.recommendations.map((move) => (
              <article key={move.title} className="rounded-md border border-border/60 bg-background/40 p-3">
                <h3 className="font-display text-base font-semibold leading-snug">{move.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{move.reason}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill>{Math.round(move.duration_minutes)}m</Pill>
                  <Pill>{move.difficulty}</Pill>
                  {move.rush ? <Pill tone="accent">Rush</Pill> : null}
                  {move.is_recovery ? <Pill tone="accent">Recovery 🛟</Pill> : null}
                </div>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  disabled={busy !== null || activeRun !== null}
                  onClick={() => void acceptAiMove(move)}
                >
                  Approve and start
                </Button>
              </article>
            ))}
            {aiMoves.data.facts_used.length ? (
              <p className="text-[11px] text-muted-foreground">
                Based on: {aiMoves.data.facts_used.join(" · ")}
              </p>
            ) : null}
          </Panel>
        ) : null}

        <div>
          <SectionTitle>Current state</SectionTitle>
          <CurrentStateBar />
        </div>

        {primary ? (
          <div className="rounded-2xl border border-primary/30 bg-surface/90 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pill tone="spark">{primary.durationMinutes} min</Pill>
                <Pill tone="muted">{primary.difficulty}</Pill>
                {primary.rush ? <Pill tone="accent">Countdown</Pill> : null}
              </div>
              <span className="text-xs font-semibold text-spark">+{primary.sparks} Sparks</span>
            </div>

            <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground">{primary.title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{primary.reason}</p>

            <div className="mt-6 space-y-2.5">
              <Button
                size="lg"
                className="w-full text-base font-semibold"
                disabled={busy !== null || activeRun !== null}
                onClick={() => void accept(primary)}
              >
                <Zap className="mr-1.5 size-5" />
                Start this ({primary.durationMinutes}m)
              </Button>

              {primary.minimumWin ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground hover:text-primary transition-colors"
                  disabled={busy !== null || activeRun !== null}
                  onClick={() =>
                    void accept({
                      ...primary,
                      title: primary.minimumWin!.title,
                      durationMinutes: primary.minimumWin!.durationMinutes,
                      reason: primary.minimumWin!.description,
                    })
                  }
                >
                  🌱 Don't need to finish everything. Start with 5 minutes: {primary.minimumWin.title}
                </Button>
              ) : null}
            </div>

            <div className="mt-3 flex justify-end border-t border-border/30 pt-3">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setSeed((s) => s + 1)}
                disabled={busy !== null}
              >
                <RefreshCw className="size-3" />
                Show something else
              </button>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Set your state above"
            body="Select your energy and available time to see your next move instantly."
          />
        )}

        {alternatives.length ? (
          <div className="pt-2">
            <SectionTitle>Alternative Options</SectionTitle>
            <div className="space-y-2.5">
              {alternatives.slice(0, 3).map((option) => (
                <div
                  key={option.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-surface/40 p-4 transition-colors hover:border-border"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-semibold text-foreground">{option.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{option.reason}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{option.durationMinutes}m</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-xs"
                      disabled={busy !== null || activeRun !== null}
                      onClick={() => void accept(option)}
                    >
                      Start
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <p className="pb-2 text-center text-xs text-muted-foreground">
          Options come from your deterministic engine. The AI proposes candidates; you decide every start.
        </p>
      </div>
    </AppShell>
  );
}