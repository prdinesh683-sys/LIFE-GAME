import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { Timer, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { BecauseLine, useBecause } from "@/components/app/because-line";
import { EmptyState, Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { QuestCard } from "@/components/app/quest-card";
import { Button } from "@/components/ui/button";
import { MISS_REASON_LABELS } from "@/lib/game/types";
import { TIME_WINDOWS, TIME_WINDOW_HINTS, TIME_WINDOW_LABELS } from "@/lib/game/time-window";
import { cn } from "@/lib/utils";
import { useGame } from "@/lib/services/game-store";

export const Route = createFileRoute("/quests/$questId")({
  head: () => ({
    meta: [
      { title: "Quest briefing — Life Game" },
      {
        name: "description",
        content:
          "Read the quest briefing, start it as a normal or Rush run, and record the outcome afterwards.",
      },
      { property: "og:title", content: "Quest briefing — Life Game" },
      {
        property: "og:description",
        content: "Start the quest, do it for real, then record the outcome.",
      },
    ],
  }),
  component: QuestDetailPage,
});

function QuestDetailPage() {
  const { questId } = useParams({ from: "/quests/$questId" });
  const { snapshot, activeRun, startQuest, setQuestWindow } = useGame();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const quest = snapshot?.quests.find((q) => q.id === questId) ?? null;
  const history = (snapshot?.questRuns ?? []).filter((r) => r.questId === questId);
  // Same deterministic selection Today uses — not a second calculation.
  const because = useBecause({
    questName: quest?.name ?? null,
    slot: quest?.timeWindow ?? null,
    shape: "create_quest",
  });

  if (!snapshot) return <AppShell title="Quest">{null}</AppShell>;

  if (!quest) {
    return (
      <AppShell title="Quest">
        <EmptyState title="Quest not found" body="It may have been archived or removed." />
      </AppShell>
    );
  }

  const begin = async (rushRequested: boolean) => {
    setBusy(true);
    try {
      await startQuest(quest.id, { rushRequested });
      toast.success("Started. Device down, go do it.");
      await navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the quest");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Quest briefing" subtitle={quest.name}>
      <div className="space-y-4">
        <QuestCard quest={quest} because={<BecauseLine reason={because} />} />

        {quest.status === "available" ? (
          <Panel>
            <SectionTitle>When do you want to do this?</SectionTitle>
            <p className="mb-2 text-xs text-muted-foreground">
              Optional. Anytime is completely fine — nothing is penalised either way.
            </p>
            <div className="grid grid-cols-4 gap-2">
              {[null, ...TIME_WINDOWS].map((window) => {
                const active = (quest.timeWindow ?? null) === window;
                return (
                  <button
                    key={window ?? "anytime"}
                    type="button"
                    onClick={() => void setQuestWindow(quest.id, window)}
                    className={cn(
                      "rounded-md border px-2 py-2 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="block font-medium">
                      {window ? TIME_WINDOW_LABELS[window] : "Anytime"}
                    </span>
                    <span className="block text-[10px] opacity-70">
                      {window ? TIME_WINDOW_HINTS[window] : "no window"}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
        ) : null}

        {quest.status === "available" ? (
          <Panel glow>
            <SectionTitle>Begin</SectionTitle>
            <Button
              size="lg"
              className="w-full"
              disabled={busy || activeRun !== null}
              onClick={() => void begin(false)}
            >
              <Zap className="size-5" />
              Start quest
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="mt-2 w-full"
              disabled={busy || activeRun !== null}
              onClick={() => void begin(true)}
            >
              <Timer className="size-5" />
              Start as Rush
            </Button>
            {activeRun ? (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Another quest is already running.
              </p>
            ) : null}
          </Panel>
        ) : (
          <Panel>
            <Pill tone={quest.status === "completed" ? "primary" : "drain"}>{quest.status}</Pill>
            <p className="mt-2 text-sm text-muted-foreground">
              This quest is closed. Anything you learned from it already feeds your next moves.
            </p>
          </Panel>
        )}

        <div>
          <SectionTitle>Run history</SectionTitle>
          {history.length ? (
            <div className="space-y-2">
              {history.map((run) => (
                <Panel key={run.id} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{new Date(run.startedAt).toLocaleString()}</p>
                    <Pill tone={run.outcome === "completed" ? "primary" : "drain"}>
                      {run.outcome === "completed"
                        ? `+${run.sparksAwarded} Sparks`
                        : run.outcome === "missed"
                          ? "Missed"
                          : "In progress"}
                    </Pill>
                  </div>
                  {run.missReason ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {MISS_REASON_LABELS[run.missReason]}
                      {run.missNote ? ` — ${run.missNote}` : ""}
                    </p>
                  ) : null}
                </Panel>
              ))}
            </div>
          ) : (
            <EmptyState title="No runs yet" body="Start it once and the history builds itself." />
          )}
        </div>
      </div>
    </AppShell>
  );
}