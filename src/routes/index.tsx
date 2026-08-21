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
    <AppShell title="Home" subtitle={`Rank ${profile.rank} · ${profile.title}`}>
      <div className="space-y-6">
        {/* ---- 1. YOUR CURRENT JOURNEY & CHAPTER ---- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-primary">Your Journey</span>
            <span>Rank {profile.rank} · {profile.title}</span>
          </div>
          <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-surface-raised/60 to-surface/40 p-5">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">CURRENT CHAPTER</p>
                <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-foreground">{profile.chapter}</h2>
              </div>
              <div className="text-right">
                <p className="numeric text-2xl font-bold text-spark">
                  {profile.sparks} <span className="text-xs font-normal text-muted-foreground">Sparks</span>
                </p>
              </div>
            </div>
            <div className="mt-4">
              <ProgressRail ratio={rank.ratio} label={`${rank.intoRank}/${rank.needed} Sparks to next rank`} />
            </div>
          </div>
        </div>

        {/* ---- 2. WHAT'S YOUR NEXT MOVE? (Dominant Stage) ---- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-foreground">What's your next move?</h2>
            <Link to="/next-move" className="text-xs text-primary hover:underline">
              All options →
            </Link>
          </div>

          {activeRun ? (
            <ActiveRunPanel />
          ) : scheduled ? (
            <div className="rounded-2xl border border-primary/30 bg-surface/90 p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Pill tone={scheduled.relevance === "now" ? "primary" : "muted"}>
                  {scheduled.quest.timeWindow
                    ? TIME_WINDOW_LABELS[scheduled.quest.timeWindow]
                    : relevanceLabel(scheduled.relevance)}
                </Pill>
                <span className="text-xs text-muted-foreground">{scheduled.quest.durationMinutes} min</span>
              </div>
              <h3 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground">{scheduled.quest.name}</h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                {scheduled.relevance === "now"
                  ? "This is the window you picked for this quest."
                  : "The scheduled window has passed, but completing it now still counts fully."}
              </p>
              <div className="mt-5 space-y-2">
                <Button
                  size="lg"
                  className="w-full text-base font-semibold"
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
                  <Zap className="mr-1.5 size-5" />
                  Start ({scheduled.quest.durationMinutes}m)
                </Button>
              </div>
            </div>
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
            <div className="rounded-2xl border border-primary/30 bg-surface/90 p-6">
              <h3 className="font-display text-xl font-bold text-foreground">{starter.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{starter.why}</p>
              <Button
                size="lg"
                className="mt-5 w-full font-semibold"
                disabled={busy !== null}
                onClick={() => void startStarter()}
              >
                <Zap className="mr-1.5 size-5" />
                Start this
              </Button>
            </div>
          ) : primary ? (
            <div className="rounded-2xl border border-primary/30 bg-surface/90 p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Pill tone="spark">{primary.durationMinutes} min</Pill>
                <Pill tone="muted">{primary.difficulty}</Pill>
                {needsRecovery ? <Pill tone="focus">recovery-friendly</Pill> : null}
              </div>
              <h3 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground">{primary.title}</h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{primary.reason}</p>
              
              <div className="mt-5 space-y-2">
                <Button
                  size="lg"
                  className="w-full text-base font-semibold"
                  disabled={busy !== null}
                  onClick={() => void startOption(primary)}
                >
                  <Zap className="mr-1.5 size-5" />
                  Start ({primary.durationMinutes}m)
                </Button>

                {primary.minimumWin ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground hover:text-primary transition-colors"
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
                    🌱 Low energy? Start with 5 minutes: {primary.minimumWin.title}
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 flex justify-between border-t border-border/30 pt-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setSeed((s) => s + 1)}
                >
                  <RefreshCw className="size-3" />
                  Show something else
                </button>
                <Link to="/next-move" className="text-xs text-muted-foreground hover:text-foreground">
                  See 3 alternatives →
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Nothing ready to start"
              body="Tell me how today feels above or select a starter from Next Move."
            />
          )}
        </div>

        {/* ---- 3. TODAY'S CONTEXT (Energy & Available Time) ---- */}
        <div>
          <SectionTitle>Today's Context</SectionTitle>
          <CurrentStateBar />
        </div>

        {/* ---- 4. PROGRESS TELEMETRY ---- */}
        <div>
          <SectionTitle>Progress</SectionTitle>
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
            <StatTile label="Completed" value={completedToday} hint="today" tone="focus" />
          </div>
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
