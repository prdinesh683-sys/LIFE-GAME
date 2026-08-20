import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { MissDialog } from "./miss-dialog";
import { Panel, Pill, ProgressRail, SectionTitle } from "./primitives";
import { RewardDialog } from "./reward-dialog";
import { Button } from "@/components/ui/button";
import { rushDeadline } from "@/lib/game/quest-engine";
import { recoveryChoices } from "@/lib/game/miss-recovery";
import { VERIFICATION_LABELS, type VerificationStatus } from "@/lib/game/types";
import { useGame, type CompletionResult } from "@/lib/services/game-store";
import { useAi } from "@/lib/services/ai-store";
import { buildMissContext } from "@/lib/game/behavior-engine";
import { MissInsightDialog, type MissInsight } from "./miss-insight-dialog";

const VERIFICATIONS: VerificationStatus[] = ["self_reported", "evidence", "verified"];

export function ActiveRunPanel() {
  const { activeRun, snapshot, completeQuest, missQuest, abandonRun, recoverFromMiss } = useGame();
  const [now, setNow] = useState(() => Date.now());
  const [missOpen, setMissOpen] = useState(false);
  const [reward, setReward] = useState<CompletionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ai = useAi();
  const [insight, setInsight] = useState<MissInsight | null>(null);

  const quest = useMemo(
    () => snapshot?.quests.find((q) => q.id === activeRun?.questId) ?? null,
    [snapshot, activeRun],
  );

  const deadline = quest && activeRun ? rushDeadline(quest, activeRun.startedAt) : null;

  useEffect(() => {
    if (!activeRun) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeRun]);

  if (!activeRun || !quest) return null;

  const started = Date.parse(activeRun.startedAt);
  const elapsedMs = Math.max(0, now - started);
  const plannedMs = quest.durationMinutes * 60000;
  const remainingRush = deadline ? Math.max(0, deadline - now) : null;
  const rushExpired = remainingRush !== null && remainingRush === 0;

  const complete = async (verification: VerificationStatus) => {
    setBusy(true);
    try {
      setReward(await completeQuest(activeRun.id, verification));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the completion");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel glow>
        <SectionTitle
          action={
            remainingRush !== null ? (
              <Pill tone={rushExpired ? "destructive" : "accent"}>
                {rushExpired ? "Rush window closed" : `Rush ${formatClock(remainingRush)}`}
              </Pill>
            ) : (
              <Pill tone="primary">In progress</Pill>
            )
          }
        >
          Active quest
        </SectionTitle>
        <h2 className="font-display text-xl font-semibold leading-snug">{quest.name}</h2>
        <p className="numeric mt-1 text-sm text-muted-foreground">
          {formatClock(elapsedMs)} elapsed · {quest.durationMinutes}m planned · {quest.sparks} Sparks
        </p>
        <div className="mt-3">
          <ProgressRail ratio={plannedMs ? elapsedMs / plannedMs : 0} tone="energy" />
        </div>

        <p className="mt-4 rounded-md border border-border/60 bg-background/40 p-3 text-sm text-muted-foreground">
          Put the device away and do the thing. Come back only to record it.
        </p>

        <SectionTitle>Record it</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {VERIFICATIONS.map((v) => (
            <Button
              key={v}
              size="sm"
              variant={v === "self_reported" ? "default" : "secondary"}
              disabled={busy}
              onClick={() => void complete(v)}
            >
              {VERIFICATION_LABELS[v]}
            </Button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMissOpen(true)}>
            Didn't happen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void abandonRun(activeRun.id)}
          >
            Put it back
          </Button>
        </div>
      </Panel>

      <MissDialog
        open={missOpen}
        onOpenChange={setMissOpen}
        recoveryChoices={recoveryChoices(quest, new Date())}
        onRecover={async (kind) => {
          try {
            await recoverFromMiss(activeRun.id, kind);
            toast(
              kind === "smaller"
                ? "Smaller version started. Go do it."
                : kind === "reschedule"
                  ? "Moved. It'll be waiting for you."
                  : "Dropped for today. It stays in your list.",
            );
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "That didn't work. Nothing was changed.");
          }
        }}
        onSubmit={async (reason, note) => {
          const context = buildMissContext({
            run: { ...activeRun, missReason: reason, missNote: note || null, outcome: "missed" },
            runs: snapshot?.questRuns ?? [],
            momentum: null,
          });
          await missQuest(activeRun.id, reason, note);
          toast("Recorded. The system will adapt around it.");
          try {
            const outcome = await ai.analyzeMiss({
              ...context,
              durationMinutes: quest.durationMinutes,
              difficulty: quest.difficulty,
            });
            setInsight({ data: outcome.value, source: outcome.source, brain: outcome.brain });
          } catch {
            /* A miss is still recorded even when no brain can read it. */
          }
        }}
      />
      <MissInsightDialog insight={missOpen ? null : insight} onClose={() => setInsight(null)} />
      <RewardDialog result={reward} onClose={() => setReward(null)} />
    </>
  );
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}