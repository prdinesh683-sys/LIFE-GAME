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
        {/* ---- Horizon HUD: Chapter & Progression ---- */}
        <Panel glow className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-surface-raised/90 via-surface to-background p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
                  {profile.chapter}
                </p>
              </div>
              <p className="numeric flex items-baseline gap-2 text-4xl font-black text-spark">
                <Sparkles className="size-6 text-spark" />
                {profile.sparks}
                <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Sparks</span>
              </p>
            </div>
            <div className="text-right">
              <Pill tone="primary">Rank {profile.rank} · {profile.title}</Pill>
              <p className="numeric mt-2 text-xs font-semibold text-muted-foreground">
                {rank.intoRank}/{rank.needed} to Rank {profile.rank + 1}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <ProgressRail ratio={rank.ratio} tone="momentum" />
          </div>
        </Panel>

        {/* ---- Telemetry Tiles: Momentum, Run & Volume ---- */}
        <div className="grid grid-cols-3 gap-2.5">
          <StatTile
            label="Momentum"
            value={Math.round(momentum.value)}
            hint={momentum.label}
            tone="momentum"
          />
          <StatTile
            label="Run Streak"
            value={`${profile.currentRun}d`}
            hint={`Best ${profile.bestRun}d`}
            tone="run"
          />
          <StatTile label="Today" value={completedToday} hint="completed" tone="focus" />
        </div>

        <div>
          <SectionTitle>Biometric & Capacity Context</SectionTitle>
          <CurrentStateBar />
        </div>

        {/* ---- The One Decision: Dominant Hero Stage ---- */}
        <div className="pt-1">
          <SectionTitle>Right Now · Core Decision</SectionTitle>
          {activeRun ? (
            <ActiveRunPanel />
          ) : scheduled ? (
            <Panel glow className="space-y-3.5 border-primary/40 bg-surface-raised/90 p-5 shadow-lg">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={scheduled.relevance === "now" ? "primary" : "muted"}>
                  {scheduled.quest.timeWindow
                    ? TIME_WINDOW_LABELS[scheduled.quest.timeWindow]
                    : relevanceLabel(scheduled.relevance)}
                </Pill>
                <Pill tone="spark">{scheduled.quest.durationMinutes} min</Pill>
                {needsRecovery ? <Pill tone="focus">recovery-friendly</Pill> : null}
              </div>
              <div className="space-y-1">
                <p className="font-display text-xl font-bold tracking-tight text-foreground">{scheduled.quest.name}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {scheduled.relevance === "now"
                    ? "This is the window you picked for this quest."
                    : "The scheduled window has passed, but completing it now still counts fully."}
                </p>
              </div>
              <Button
                size="lg"
                className="w-full font-bold shadow-md hover:brightness-110"
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
                Start this ({scheduled.quest.durationMinutes}m)
              </Button>
              <Button asChild variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-foreground">
                <Link to="/next-move">
                  More options
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
            <Panel glow className="space-y-3.5 border-primary/40 bg-surface-raised/90 p-5 shadow-lg">
              <div className="space-y-1">
                <p className="font-display text-xl font-bold text-foreground">{starter.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{starter.why}</p>
              </div>
              <Button
                size="lg"
                className="w-full font-bold shadow-md hover:brightness-110"
                disabled={busy !== null}
                onClick={() => void startStarter()}
              >
                <Zap className="size-5" />
                Start this
              </Button>
            </Panel>
          ) : primary ? (
            <Panel glow className="space-y-4 border-primary/40 bg-surface-raised/90 p-5 shadow-lg">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Priority Next Move</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone="spark">
                      <Timer className="mr-1 inline size-3" />
                      {primary.durationMinutes}m
                    </Pill>
                    <Pill tone="muted">{primary.difficulty}</Pill>
                    {needsRecovery ? <Pill tone="focus">recovery</Pill> : null}
                  </div>
                </div>
                <p className="font-display text-xl font-black tracking-tight text-foreground">{primary.title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{primary.reason}</p>
              </div>
              
              <Button
                size="lg"
                className="w-full font-bold tracking-wide shadow-md hover:brightness-110"
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
                  className="w-full border-primary/40 bg-primary/10 text-xs font-bold text-primary transition-all hover:bg-primary/20 hover:border-primary"
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

              <div className="flex gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1 font-medium text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSeed((s) => s + 1)}
                >
                  <RefreshCw className="mr-1 size-3.5" />
                  Show alternative
                </Button>
                <Button asChild variant="ghost" size="sm" className="flex-1 font-medium text-xs text-muted-foreground hover:text-foreground">
                  <Link to="/next-move">All options</Link>
                </Button>
              </div>
            </Panel>
          ) : (
            <EmptyState
              title="Nothing ready to start"
              body="Tell me how today feels above or select a starter from Next Move."
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
