import type { EconomyConfig, Profile } from "./types";

/** RunEngine — Runs 🔥 replace streaks. One missed day never wipes identity. */

export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);
}

export interface RunOutcome {
  currentRun: number;
  bestRun: number;
  extended: boolean;
  recovered: boolean;
  milestone: number | null;
}

export const RUN_MILESTONES = [3, 7, 14, 30, 60, 100];

export function advanceRun(
  config: EconomyConfig,
  profile: Profile,
  today: string = dayKey(),
): RunOutcome {
  const last = profile.lastActiveDay;
  if (last === today) {
    return {
      currentRun: profile.currentRun,
      bestRun: profile.bestRun,
      extended: false,
      recovered: false,
      milestone: null,
    };
  }

  const gap = last ? daysBetween(last, today) : Infinity;
  let currentRun: number;
  let recovered = false;

  if (!last) {
    currentRun = 1;
  } else if (gap === 1) {
    currentRun = profile.currentRun + 1;
  } else if (gap - 1 <= config.runGraceDays) {
    // Inside the grace window the Run survives — no shame, no reset.
    currentRun = profile.currentRun + 1;
    recovered = true;
  } else {
    currentRun = 1;
    recovered = true;
  }

  const bestRun = Math.max(profile.bestRun, currentRun);
  const milestone = RUN_MILESTONES.includes(currentRun) ? currentRun : null;
  return { currentRun, bestRun, extended: true, recovered, milestone };
}