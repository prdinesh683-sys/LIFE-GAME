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
          <Panel glow>
            <SectionTitle
              action={<Pill tone="accent">{primary.rush ? "Rush" : primary.category}</Pill>}
            >
              Recommended
            </SectionTitle>
            <h2 className="font-display text-2xl font-semibold leading-snug">{primary.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{primary.reason}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Pill>{primary.durationMinutes}m</Pill>
              <Pill tone="spark">
                <Sparkles className="size-3" />
                {primary.sparks}
              </Pill>
              <Pill tone="primary">{ATTRIBUTE_LABELS[primary.attribute]}</Pill>
              {primary.destinationTitle ? <Pill>{primary.destinationTitle}</Pill> : null}
              {primary.rush ? (
                <Pill tone="accent">
                  <Timer className="size-3" />
                  Countdown
                </Pill>
              ) : null}
            </div>
            <Button
              size="lg"
              className="mt-4 w-full"
              disabled={busy !== null || activeRun !== null}
              onClick={() => void accept(primary)}
            >
              <Zap className="size-5" />
              Start now
            </Button>
            <Button
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => setSeed((s) => s + 1)}
              disabled={busy !== null}
            >
              <RefreshCw className="size-4" />
              Something else
            </Button>
          </Panel>
        ) : (
          <Panel>
            <p className="text-sm text-muted-foreground">
              Set your current state above and options will appear instantly.
            </p>
          </Panel>
        )}

        {alternatives.length ? (
          <div>
            <SectionTitle>Other moves</SectionTitle>
            <div className="space-y-3">
              {alternatives.map((option) => (
                <article key={option.id} className="panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold leading-snug">
                        {option.title}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">{option.reason}</p>
                    </div>
                    <span className="numeric shrink-0 text-sm font-bold text-spark">
                      {option.sparks}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Pill>{option.durationMinutes}m</Pill>
                    <Pill>{option.category}</Pill>
                    <Pill tone="primary">{ATTRIBUTE_LABELS[option.attribute]}</Pill>
                    {option.isRecovery ? <Pill tone="accent">Recovery 🛟</Pill> : null}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={busy !== null || activeRun !== null}
                    onClick={() => void accept(option)}
                  >
                    Take this instead
                  </Button>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        <p className="pb-2 text-center text-xs text-muted-foreground">
          Options come from the deterministic engine. When an AI brain is connected it can propose
          moves here too — you still approve every one.
        </p>
      </div>
    </AppShell>
  );
}