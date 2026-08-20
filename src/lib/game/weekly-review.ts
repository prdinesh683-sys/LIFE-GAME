import type { QuestRun } from "./types";

/**
 * Lightweight weekly review (Phase 5, item 8).
 *
 * Deterministic summary built from records that already exist. It is a short
 * story, not an analytics dashboard: what you accepted, what you finished, what
 * worked, what didn't, and one adjustment worth making.
 */

export interface WeeklyReviewInput {
  runs: QuestRun[];
  /** Advisor decisions in the window: approved / applied / rejected counts. */
  accepted: number;
  rejected: number;
  now?: number;
}

export interface WeeklyReview {
  from: string;
  to: string;
  accepted: number;
  completed: number;
  missed: number;
  rejected: number;
  worked: string[];
  didNotWork: string[];
  learned: string[];
  adjustment: string;
  hasEvidence: boolean;
}

const WEEK = 7 * 86_400_000;

/** Elapsed minutes of a finished run; null when it never ended. */
function minutesOf(run: QuestRun): number | null {
  if (!run.endedAt) return null;
  return Math.max(0, Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 60_000));
}

function hourBucket(iso: string): "morning" | "afternoon" | "evening" {
  const hour = new Date(iso).getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const now = input.now ?? Date.now();
  const from = now - WEEK;
  const window = input.runs.filter((r) => Date.parse(r.startedAt) >= from);
  const completed = window.filter((r) => r.outcome === "completed");
  const missed = window.filter((r) => r.outcome === "missed");

  const worked: string[] = [];
  const didNotWork: string[] = [];
  const learned: string[] = [];

  const buckets = { morning: 0, afternoon: 0, evening: 0 };
  for (const run of completed) buckets[hourBucket(run.startedAt)] += 1;
  const bestBucket = (Object.entries(buckets) as [keyof typeof buckets, number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];

  if (completed.length) {
    worked.push(`You finished ${completed.length} quest${completed.length === 1 ? "" : "s"} this week.`);
  }
  const quickWins = completed.filter((r) => minutesOf(r) != null && minutesOf(r)! <= 15).length;
  if (quickWins >= 2) worked.push("Short quests were the ones you actually finished.");

  if (missed.length) {
    didNotWork.push(`${missed.length} quest${missed.length === 1 ? "" : "s"} didn't get done.`);
  }
  const timeMisses = missed.filter(
    (r) => r.missReason === "no_time" || r.missReason === "too_difficult",
  ).length;
  if (timeMisses >= 2) didNotWork.push("Quests that needed a big block of time were the ones skipped.");

  if (bestBucket && bestBucket[1] >= 2) {
    learned.push(`You get more done in the ${bestBucket[0]}, so I'll lean that way.`);
  }
  if (input.rejected >= 2) {
    learned.push("You turned down several suggestions, so I'll suggest less of that kind.");
  }

  let adjustment = "Keep going — one real action a day is enough.";
  if (timeMisses >= 2) adjustment = "Try cutting your next session in half. Finished beats ambitious.";
  else if (bestBucket && bestBucket[1] >= 2) {
    adjustment = `Put tomorrow's first quest in the ${bestBucket[0]}.`;
  } else if (!completed.length) {
    adjustment = "Start with one five-minute quest today to get the loop moving again.";
  }

  return {
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    accepted: input.accepted,
    completed: completed.length,
    missed: missed.length,
    rejected: input.rejected,
    worked,
    didNotWork,
    learned,
    adjustment,
    hasEvidence: window.length > 0 || input.accepted > 0 || input.rejected > 0,
  };
}
