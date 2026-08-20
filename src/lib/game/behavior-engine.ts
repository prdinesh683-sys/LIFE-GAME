import type {
  ActivityEvent,
  Boost,
  Drain,
  MissReason,
  QuestRun,
} from "./types";
import { MISS_REASON_LABELS } from "./types";

/**
 * BehaviorEngine — turns misses and logged patterns into learning data.
 * Never labels the user; only describes observed behaviour.
 */

export interface MissAnalysisContext {
  questName: string;
  durationMinutes: number;
  difficulty: string;
  timeOfDay: string;
  energy: number | null;
  mood: number | null;
  momentum: number | null;
  reason: MissReason | null;
  note: string | null;
  similarQuestCompletionRate: number | null;
  recentCompletions: number;
  recentMisses: number;
}

export function buildMissContext(params: {
  run: QuestRun;
  runs: QuestRun[];
  momentum: number | null;
}): MissAnalysisContext {
  const { run, runs, momentum } = params;
  const similar = runs.filter(
    (r) => r.questName === run.questName && r.outcome !== "in_progress" && r.id !== run.id,
  );
  const completed = similar.filter((r) => r.outcome === "completed").length;
  const started = Date.parse(run.startedAt);
  const hour = new Date(started).getHours();

  const recent = runs.filter((r) => Date.now() - Date.parse(r.startedAt) < 7 * 86400000);

  return {
    questName: run.questName,
    durationMinutes: 0,
    difficulty: "unknown",
    timeOfDay: `${`${hour}`.padStart(2, "0")}:00`,
    energy: run.energyAtStart,
    mood: run.moodAtStart,
    momentum,
    reason: run.missReason,
    note: run.missNote,
    similarQuestCompletionRate: similar.length ? completed / similar.length : null,
    recentCompletions: recent.filter((r) => r.outcome === "completed").length,
    recentMisses: recent.filter((r) => r.outcome === "missed").length,
  };
}

export interface ObservedPattern {
  id: string;
  label: string;
  detail: string;
  weight: number;
}

/** Deterministic pattern detection used until an analysis brain is connected. */
export function detectPatterns(runs: QuestRun[], events: ActivityEvent[]): ObservedPattern[] {
  const patterns: ObservedPattern[] = [];
  const finished = runs.filter((r) => r.outcome !== "in_progress");
  if (finished.length < 3) return patterns;

  const reasonCounts = new Map<MissReason, number>();
  for (const run of finished) {
    if (run.outcome === "missed" && run.missReason) {
      reasonCounts.set(run.missReason, (reasonCounts.get(run.missReason) ?? 0) + 1);
    }
  }
  const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topReason) {
    patterns.push({
      id: "top_miss_reason",
      label: `Most common blocker: ${MISS_REASON_LABELS[topReason[0]]}`,
      detail: `Recorded ${topReason[1]} time(s). Worth designing around, not fighting.`,
      weight: topReason[1],
    });
  }

  const completedRuns = finished.filter((r) => r.outcome === "completed");
  if (completedRuns.length >= 3) {
    const hours = completedRuns.map((r) => new Date(Date.parse(r.startedAt)).getHours());
    const mode = hours
      .sort()
      .reduce<{ hour: number; count: number }>(
        (best, h) => {
          const count = hours.filter((x) => Math.abs(x - h) <= 1).length;
          return count > best.count ? { hour: h, count } : best;
        },
        { hour: hours[0]!, count: 0 },
      );
    patterns.push({
      id: "best_window",
      label: `Strongest window: around ${`${mode.hour}`.padStart(2, "0")}:00`,
      detail: `${mode.count} of your completions cluster there.`,
      weight: mode.count,
    });
  }

  const boostEvents = events.filter((e) => e.type === "boost_logged");
  if (boostEvents.length >= 2) {
    patterns.push({
      id: "boost_usage",
      label: `${boostEvents.length} Boosts logged outside quests`,
      detail: "Spontaneous action is showing up — that's real momentum.",
      weight: boostEvents.length,
    });
  }

  return patterns.sort((a, b) => b.weight - a.weight);
}

/** Trigger → Interrupt → Replacement: what to do the moment a Drain fires. */
export function counterMoveFor(drain: Drain, boosts: Boost[]) {
  const replacement = boosts.find(
    (b) => b.replacesDrainId === drain.id || b.name.toLowerCase() === drain.replacement.toLowerCase(),
  );
  return {
    title: replacement?.name ?? (drain.replacement || "2-minute reset"),
    minutes: replacement?.durationMinutes ?? drain.counterMoveMinutes,
    attribute: replacement?.attribute ?? drain.counterMoveAttribute,
    boostId: replacement?.id ?? null,
  };
}