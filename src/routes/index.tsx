import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Flame, RefreshCw, Sparkles, Timer, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ActiveRunPanel } from "@/components/app/active-run-panel";
import { BecauseLine, useBecause } from "@/components/app/because-line";
import { AdvisorCard } from "@/components/app/advisor-card";
import { AppShell } from "@/components/app/app-shell";
import { CurrentStateBar } from "@/components/app/current-state-bar";
import { OutcomeSummary } from "@/components/app/outcome-summary";
import { EmptyState, Panel, Pill, ProgressRail, SectionTitle, StatTile } from "@/components/app/primitives";
import { QuestCard } from "@/components/app/quest-card";
import { WeeklyReviewPanel } from "@/components/app/weekly-review-panel";
import { Button } from "@/components/ui/button";
import { evidenceState, hasHistoricalEvidence, starterRecommendation } from "@/lib/game/cold-start";
import { generateNextMoves, optionToDraft, type NextMoveOption } from "@/lib/game/recommendation-engine";
import { dayKey } from "@/lib/game/run-engine";
import { rhythmOf, shouldOfferClose, shouldPromptReentry, summariseDay } from "@/lib/game/daily-rhythm";
import {
  currentSlot,
  nextLaterToday,
  pickScheduledQuest,
  relevanceLabel,
  TIME_WINDOW_LABELS,
} from "@/lib/game/time-window";
import { permissionForAction, useAdvisor } from "@/lib/services/advisor-store";
import { useAgent } from "@/lib/services/agent-store";
import { useGame } from "@/lib/services/game-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today — Life Game" },
      {
        name: "description",
        content:
          "One screen for today: your current state, the single next action worth doing, and what changed after you did the last one.",
      },
      { property: "og:title", content: "Today — Life Game" },
      {
        property: "og:description",
        content: "Your state, one clear next action, and the result of the last one.",
      },
    ],
  }),
  component: TodayPage,
});

/**
 * Today (Phase 5, items 1–6).
 *
 * The single front door. Everything that previously competed for "what should
 * I do next" — Home, Next Move, the Advisor teaser and the Agent — resolves
 * here into exactly one primary decision. The other screens still exist at
 * their old URLs for depth; they are no longer the way in.
 */
function TodayPage() {
  const {
    snapshot,
    momentum,
    rank,
    today: daily,
    activeRun,
    needsRecovery,
    patterns,
    createQuest,
    startQuest,
    openDay,
    closeDay,
    updateSettings,
  } = useGame();
  const advisor = useAdvisor();
  const agent = useAgent();
  const navigate = useNavigate();
  const [seed, setSeed] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // One explicit clock for every time-of-day decision on this screen.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Daily open: the first time Today is loaded on a new day.
  useEffect(() => {
    if (!snapshot) return;
    void openDay();
  }, [snapshot, openDay]);

  // Device-local re-entry nudge. Off by default, at most once per day.
  useEffect(() => {
    if (!snapshot) return;
    const rhythm = rhythmOf(snapshot.settings);
    const due = shouldPromptReentry({
      rhythm,
      now: nowMs,
      hasActiveRun: activeRun !== null,
      hasSomethingToDo: snapshot.quests.some((q) => q.status === "available"),
    });
    if (!due) return;
    const day = dayKey();
    void updateSettings({ rhythm: { ...rhythm, lastPromptedDay: day } });
    toast("Good moment for one small real action.");
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Life Game", { body: "Good moment for one small real action." });
      } catch {
        /* The in-app reminder is the real one; the system one is a bonus. */
      }
    }
  }, [snapshot, nowMs, activeRun, updateSettings]);

  const options = useMemo<NextMoveOption[]>(() => {
    if (!snapshot) return [];
    return generateNextMoves({
      config: snapshot.settings.economy,
      boosts: snapshot.boosts,
      destinations: snapshot.destinations,
      runs: snapshot.questRuns,
      today: daily,
      momentum: momentum.value,
      blueprint: snapshot.blueprint,
      needsRecovery,
      seed,
    });
  }, [snapshot, daily, momentum.value, needsRecovery, seed]);

  // Phase 6B: one deterministic reason, selected once and shared by every
  // surface on this screen. Hooks run before the loading return.
  const topAdvice = advisor.live[0] ?? null;
  const adviceBecause = useBecause({
    shape: topAdvice?.action.type ?? null,
    slot: currentSlot(nowMs),
  });

  if (!snapshot) return <AppShell title="Today">{null}</AppShell>;


  const { profile } = snapshot;
  const dk = dayKey();
  const todayQuests = snapshot.quests.filter(
    (q) => q.status === "available" && (!q.scheduledFor || q.scheduledFor.startsWith(dk)),
  );
  const completedToday = snapshot.questRuns.filter(
    (r) => r.outcome === "completed" && r.startedAt.startsWith(dk),
  ).length;

  const evidence = evidenceState({
    runs: snapshot.questRuns,
    blueprint: snapshot.blueprint,
    destinations: snapshot.destinations,
  });
  const coldStart = !hasHistoricalEvidence(evidence);
  const starter = starterRecommendation({
    today: daily,
    destinations: snapshot.destinations,
    blueprint: snapshot.blueprint,
  });

  const primary = options[0] ?? null;

  // Phase 6A ordering: active run, then a quest whose window is now, then a
  // quest whose window has passed but is still doable, then anything-anytime.
  const scheduled = pickScheduledQuest(todayQuests, nowMs);
  const upNext = nextLaterToday(todayQuests, nowMs);
  const daySummary = summariseDay({ runs: snapshot.questRuns, today: daily, now: nowMs });
  const offerClose = shouldOfferClose(daily, nowMs);

  const startOption = async (option: NextMoveOption) => {
    setBusy(option.id);
    try {
      const quest = await createQuest(optionToDraft(option));
      await startQuest(quest.id, { rushRequested: option.rush });
      toast.success("Quest started. Put the device away.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start that quest");
    } finally {
      setBusy(null);
    }
  };

  const startStarter = async () => {
    setBusy("starter");
    try {
      const quest = await createQuest({
        name: starter.title,
        description: starter.why,
        durationMinutes: starter.durationMinutes,
        difficulty: "easy",
        createdBy: "engine",
      });
      await startQuest(quest.id);
      toast.success("Quest started. Put the device away.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start that quest");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell title="Today" subtitle={`Rank ${profile.rank} · ${profile.title}`}>
      <div className="space-y-4">
        <Panel glow>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {profile.chapter}
              </p>
              <p className="numeric mt-1 flex items-center gap-2 text-4xl font-bold text-spark">
                <Sparkles className="size-7" />
                {profile.sparks}
              </p>
            </div>
            <div className="text-right">
              <Pill tone="primary">Rank {profile.rank}</Pill>
              <p className="numeric mt-2 text-xs text-muted-foreground">
                {rank.intoRank}/{rank.needed} to Rank {profile.rank + 1}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <ProgressRail ratio={rank.ratio} />
          </div>
        </Panel>

        <div className="grid grid-cols-3 gap-2">
          <StatTile
            label="Momentum"
            value={Math.round(momentum.value)}
            hint={momentum.label}
            tone="momentum"
          />
          <StatTile
            label="Run"
            value={`${profile.currentRun}d`}
            hint={`Best ${profile.bestRun}d`}
            tone="run"
          />
          <StatTile label="Today" value={completedToday} hint="quests done" />
        </div>

        <div>
          <SectionTitle>How you're doing right now</SectionTitle>
          <CurrentStateBar />
        </div>

        {/* ---- The one decision ---- */}
        <div>
          <SectionTitle>Right now</SectionTitle>
          {activeRun ? (
            <ActiveRunPanel />
          ) : scheduled ? (
            <Panel glow className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={scheduled.relevance === "now" ? "primary" : "muted"}>
                  {scheduled.quest.timeWindow
                    ? TIME_WINDOW_LABELS[scheduled.quest.timeWindow]
                    : "Anytime"}
                </Pill>
                <Pill tone="muted">{relevanceLabel(scheduled.relevance)}</Pill>
              </div>
              <p className="text-sm font-medium">{scheduled.quest.name}</p>
              <p className="text-xs text-muted-foreground">
                {scheduled.relevance === "now"
                  ? "This is the part of the day you picked for it."
                  : "The window you picked has passed. Doing it now still counts exactly the same."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="spark">
                  <Timer className="mr-1 inline size-3" />
                  {scheduled.quest.durationMinutes} min
                </Pill>
                <Pill tone="muted">{scheduled.quest.difficulty}</Pill>
              </div>
              <Button
                size="lg"
                className="w-full"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(scheduled.quest.id);
                  try {
                    await startQuest(scheduled.quest.id);
                    toast.success("Quest started. Put the device away.");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not start that quest");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Zap className="size-5" />
                Start this
              </Button>
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link to="/quests/$questId" params={{ questId: scheduled.quest.id }}>
                  Open quest
                </Link>
              </Button>
            </Panel>
          ) : topAdvice ? (
            <AdvisorCard
              record={topAdvice}
              outcome={advisor.outcomeFor(topAdvice.id)}
              busy={advisor.generating}
              because={<BecauseLine reason={adviceBecause} />}
              onApprove={(id, force, optionId) => void advisor.approve(id, { force, optionId })}
              onReject={(id, reason) => void advisor.reject(id, reason)}
              streamlined={advisor.isStreamlined(topAdvice)}
              trustOffer={advisor.trustOfferFor(topAdvice)}
              onTrust={(actionType) =>
                void advisor.grantActionTrust(actionType, permissionForAction(topAdvice.action))
              }
            />

          ) : coldStart && !primary ? (
            <Panel glow className="space-y-3">
              <p className="text-sm font-medium">{starter.title}</p>
              <p className="text-xs text-muted-foreground">{starter.why}</p>
              <Button
                size="lg"
                className="w-full"
                disabled={busy !== null}
                onClick={() => void startStarter()}
              >
                <Zap className="size-5" />
                Start this
              </Button>
            </Panel>
          ) : primary ? (
            <Panel glow className="space-y-3">
              <p className="text-sm font-medium">{primary.title}</p>
              <p className="text-xs text-muted-foreground">{primary.reason}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="spark">
                  <Timer className="mr-1 inline size-3" />
                  {primary.durationMinutes} min
                </Pill>
                <Pill tone="muted">{primary.difficulty}</Pill>
                {needsRecovery ? <Pill tone="muted">recovery-friendly</Pill> : null}
              </div>
              <Button
                size="lg"
                className="w-full"
                disabled={busy !== null}
                onClick={() => void startOption(primary)}
              >
                <Zap className="size-5" />
                Start this ({primary.durationMinutes}m)
              </Button>
              {primary.minimumWin && (needsRecovery || (daily && (daily.energy <= 2 || daily.availableMinutes <= 15))) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-primary/40 bg-primary/5 text-xs text-primary hover:bg-primary/10"
                  disabled={busy !== null}
                  onClick={() =>
                    void startOption({
                      ...primary,
                      title: primary.minimumWin!.title,
                      durationMinutes: primary.minimumWin!.durationMinutes,
                      reason: primary.minimumWin!.description,
                    })
                  }
                >
                  ⚡ Start 5m Minimum Win: {primary.minimumWin.durationMinutes}m micro-action
                </Button>
              ) : null}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => setSeed((s) => s + 1)}
                >
                  <RefreshCw className="size-4" />
                  Show me something else
                </Button>
                <Button asChild variant="ghost" size="sm" className="flex-1">
                  <Link to="/next-move">More options</Link>
                </Button>
              </div>
            </Panel>
          ) : (
            <EmptyState
              title="Nothing right now"
              body={
                upNext
                  ? `"${upNext.quest.name}" is set for the ${
                      upNext.quest.timeWindow
                        ? TIME_WINDOW_LABELS[upNext.quest.timeWindow].toLowerCase()
                        : "day"
                    }. Nothing else is waiting on you.`
                  : "Tell me how today feels above, and I'll suggest one small real action."
              }
            />
          )}
        </div>

        <OutcomeSummary />

        {offerClose ? (
          <Panel className="space-y-2">
            <SectionTitle>Close the day</SectionTitle>
            <p className="text-sm text-muted-foreground">
              {daySummary.completed} done · {daySummary.missed} missed · {daySummary.sparks} Sparks
              today.
            </p>
            <Button variant="secondary" className="w-full" onClick={() => void closeDay()}>
              That's my day
            </Button>
          </Panel>
        ) : null}

        {agent.activePlan ? (
          <Panel className="space-y-2">
            <SectionTitle
              action={
                <Link to="/agent" className="text-xs text-primary hover:underline">
                  Open
                </Link>
              }
            >
              A plan is running
            </SectionTitle>
            <p className="text-sm">{agent.activePlan.goalText}</p>
            <p className="text-xs text-muted-foreground">
              {agent.readyFor(agent.activePlan.id).length} step(s) ready ·{" "}
              {agent.blockedFor(agent.activePlan.id).length} waiting
            </p>
          </Panel>
        ) : null}

        <WeeklyReviewPanel />

        <div>
          <SectionTitle
            action={
              <Link to="/quests" className="text-xs text-primary hover:underline">
                All quests
              </Link>
            }
          >
            Ready to run
          </SectionTitle>
          {todayQuests.length ? (
            <div className="space-y-3">
              {todayQuests.slice(0, 3).map((quest) => (
                <QuestCard
                  key={quest.id}
                  quest={quest}
                  action={
                    <Button asChild variant="secondary" size="sm" className="w-full">
                      <Link to="/quests/$questId" params={{ questId: quest.id }}>
                        Open quest
                      </Link>
                    </Button>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No quests queued"
              body="Start the action above, or create your own in Quests."
            />
          )}
        </div>

        {patterns.length ? (
          <div>
            <SectionTitle>What I've noticed</SectionTitle>
            <div className="space-y-2">
              {patterns.map((pattern) => (
                <Panel key={pattern.id} className="p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Flame className="size-4 text-accent" />
                    {pattern.label}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{pattern.detail}</p>
                </Panel>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
