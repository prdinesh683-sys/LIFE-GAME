import { detectPatterns } from "../game/behavior-engine";
import { dayKey } from "../game/run-engine";
import type { GameSnapshot, MissReason, QuestRun } from "../game/types";
import { MISS_REASON_LABELS } from "../game/types";

/**
 * Deterministic facts and metrics. Computed only from local records — every
 * number here is provable from the player's own data, so the Advisor can label
 * it a FACT rather than a guess.
 */

export interface AdvisorFacts {
  at: string;
  momentum: number;
  rank: number;
  sparks: number;
  currentRun: number;
  bestRun: number;
  energy: number | null;
  mood: number | null;
  availableMinutes: number | null;
  hasActiveRun: boolean;
  finishedRuns: number;
  completions7d: number;
  misses7d: number;
  completionRate7d: number | null;
  completionRate30d: number | null;
  completionsToday: number;
  hoursSinceLastAction: number | null;
  topMissReason: { reason: MissReason; label: string; count: number } | null;
  bestHour: number | null;
  activeDestinations: { id: string; title: string; progress: number; priority: number; staleDays: number | null }[];
  unusedBoosts: { id: string; name: string; minutes: number }[];
  loggedDrains7d: number;
  patterns: string[];
  /** Hours left in the local day — the only hard deadline the engine can prove. */
  hoursLeftToday: number;
  /** An active run that has no completion yet today loses a day at midnight. */
  runAtRisk: boolean;
  /** 7-day completion rate minus the 30-day baseline (null when unmeasurable). */
  rateDeltaVs30d: number | null;
  /** Two or more high-priority destinations competing for the same attention. */
  competingDestinations: { id: string; title: string; priority: number; staleDays: number | null }[];
  /** Fingerprint of the deterministic state a recommendation was reasoned from. */
  stateHash: string;
}

function within(run: QuestRun, days: number): boolean {
  return Date.now() - Date.parse(run.startedAt) <= days * 86_400_000;
}

function rate(runs: QuestRun[]): number | null {
  const finished = runs.filter((r) => r.outcome !== "in_progress");
  if (!finished.length) return null;
  return finished.filter((r) => r.outcome === "completed").length / finished.length;
}

export function buildAdvisorFacts(snapshot: GameSnapshot, momentum: number): AdvisorFacts {
  const today = snapshot.dailyStates.find((d) => d.id === dayKey()) ?? null;
  const runs = snapshot.questRuns;
  const finished = runs.filter((r) => r.outcome !== "in_progress");
  const last7 = runs.filter((r) => within(r, 7));
  const last30 = runs.filter((r) => within(r, 30));

  const lastAction = finished
    .map((r) => Date.parse(r.endedAt ?? r.startedAt))
    .sort((a, b) => b - a)[0];

  const reasonCounts = new Map<MissReason, number>();
  for (const run of last30) {
    if (run.outcome === "missed" && run.missReason) {
      reasonCounts.set(run.missReason, (reasonCounts.get(run.missReason) ?? 0) + 1);
    }
  }
  const topReasonEntry = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  const hourCounts = new Map<number, number>();
  for (const run of last30.filter((r) => r.outcome === "completed")) {
    const hour = new Date(Date.parse(run.startedAt)).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  const bestHourEntry = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  const usedBoostIds = new Set(
    runs
      .filter((r) => within(r, 14))
      .map((r) => snapshot.quests.find((q) => q.id === r.questId)?.boostId)
      .filter((id): id is string => Boolean(id)),
  );

  const activeDestinations = snapshot.destinations
    .filter((d) => d.status === "active")
    .sort((a, b) => a.priority - b.priority)
    .map((d) => {
      const questIds = new Set(snapshot.quests.filter((q) => q.destinationId === d.id).map((q) => q.id));
      const lastTouch = runs
        .filter((r) => questIds.has(r.questId))
        .map((r) => Date.parse(r.startedAt))
        .sort((a, b) => b - a)[0];
      return {
        id: d.id,
        title: d.title,
        progress: d.progress,
        priority: d.priority,
        staleDays: lastTouch ? Math.floor((Date.now() - lastTouch) / 86_400_000) : null,
      };
    });

  const now = new Date();
  const hoursLeftToday =
    (new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()) /
    3_600_000;

  const rate7 = rate(last7);
  const rate30 = rate(last30);

  const competingDestinations = activeDestinations
    .filter((d) => d.priority <= 2 && (d.staleDays == null || d.staleDays >= 3))
    .slice(0, 3);

  const facts: Omit<AdvisorFacts, "stateHash"> = {
    at: new Date().toISOString(),
    momentum: Math.round(momentum),
    rank: snapshot.profile.rank,
    sparks: snapshot.profile.sparks,
    currentRun: snapshot.profile.currentRun,
    bestRun: snapshot.profile.bestRun,
    energy: today?.energy ?? null,
    mood: today?.mood ?? null,
    availableMinutes: today?.availableMinutes ?? null,
    hasActiveRun: runs.some((r) => r.outcome === "in_progress"),
    finishedRuns: finished.length,
    completions7d: last7.filter((r) => r.outcome === "completed").length,
    misses7d: last7.filter((r) => r.outcome === "missed").length,
    completionRate7d: rate7,
    completionRate30d: rate30,
    completionsToday: finished.filter(
      (r) => r.outcome === "completed" && r.startedAt.slice(0, 10) === dayKey(),
    ).length,
    hoursSinceLastAction: lastAction ? (Date.now() - lastAction) / 3_600_000 : null,
    topMissReason: topReasonEntry
      ? {
          reason: topReasonEntry[0],
          label: MISS_REASON_LABELS[topReasonEntry[0]],
          count: topReasonEntry[1],
        }
      : null,
    bestHour: bestHourEntry ? bestHourEntry[0] : null,
    activeDestinations,
    unusedBoosts: snapshot.boosts
      .filter((b) => !usedBoostIds.has(b.id))
      .slice(0, 5)
      .map((b) => ({ id: b.id, name: b.name, minutes: b.durationMinutes })),
    loggedDrains7d: snapshot.events.filter(
      (e) => e.type === "drain_logged" && Date.now() - Date.parse(e.timestamp) <= 7 * 86_400_000,
    ).length,
    patterns: detectPatterns(runs, snapshot.events).map((p) => p.label),
    hoursLeftToday: Math.round(hoursLeftToday * 10) / 10,
    runAtRisk:
      snapshot.profile.currentRun >= 2 &&
      hoursLeftToday <= 6 &&
      finished.filter((r) => r.outcome === "completed" && r.startedAt.slice(0, 10) === dayKey())
        .length === 0,
    rateDeltaVs30d: rate7 != null && rate30 != null ? Math.round((rate7 - rate30) * 100) / 100 : null,
    competingDestinations,
  };

  return { ...facts, stateHash: hashState(facts) };
}

/**
 * Small stable fingerprint of the state that matters for a recommendation.
 * Used for stale detection at approval time, not for security.
 */
export function hashState(facts: Omit<AdvisorFacts, "stateHash">): string {
  const material = [
    facts.momentum,
    facts.energy,
    facts.mood,
    facts.availableMinutes,
    facts.hasActiveRun ? 1 : 0,
    facts.completionsToday,
    facts.completions7d,
    facts.misses7d,
    facts.currentRun,
  ].join("|");
  let hash = 0;
  for (let i = 0; i < material.length; i += 1) {
    hash = (hash * 31 + material.charCodeAt(i)) | 0;
  }
  return `st${(hash >>> 0).toString(36)}`;
}