/**
 * Daily rhythm (Phase 6A).
 *
 * Open and close are not screens and not a new store: they are two optional
 * timestamps on the day row that already exists. Everything here is a pure
 * decision taken from an explicit `now`.
 */

import { currentSlot, localDayKey, type TimeWindow } from "./time-window";
import type { DailyState, QuestRun } from "./types";

export interface RhythmSettings {
  reentryEnabled: boolean;
  slots: TimeWindow[];
  lastPromptedDay: string | null;
}

export const DEFAULT_RHYTHM: RhythmSettings = {
  reentryEnabled: false,
  slots: [],
  lastPromptedDay: null,
};

export function rhythmOf(settings: { rhythm?: Partial<RhythmSettings> } | null | undefined): RhythmSettings {
  const raw = settings?.rhythm;
  if (!raw) return DEFAULT_RHYTHM;
  return {
    reentryEnabled: raw.reentryEnabled ?? false,
    slots: raw.slots ?? [],
    lastPromptedDay: raw.lastPromptedDay ?? null,
  };
}

/** True the first time Today is opened on a new day. */
export function needsOpen(today: DailyState | null | undefined): boolean {
  return !today?.openedAt;
}

export function isDayClosed(today: DailyState | null | undefined): boolean {
  return Boolean(today?.closedAt);
}

/** The close section only appears in the evening, and only once per day. */
export function shouldOfferClose(
  today: DailyState | null | undefined,
  now: Date | number | string,
): boolean {
  if (isDayClosed(today)) return false;
  return currentSlot(now) === "evening";
}

export interface DaySummary {
  dayKey: string;
  completed: number;
  missed: number;
  sparks: number;
  opened: boolean;
  closed: boolean;
}

/** Deterministic close summary, computed only from recorded runs. */
export function summariseDay(input: {
  runs: QuestRun[];
  today: DailyState | null | undefined;
  now: Date | number | string;
}): DaySummary {
  const key = localDayKey(input.now);
  const runs = input.runs.filter((run) => run.startedAt.slice(0, 10) === key);
  return {
    dayKey: key,
    completed: runs.filter((r) => r.outcome === "completed").length,
    missed: runs.filter((r) => r.outcome === "missed").length,
    sparks: runs.reduce((total, run) => total + (run.sparksAwarded || 0), 0),
    opened: Boolean(input.today?.openedAt),
    closed: Boolean(input.today?.closedAt),
  };
}

/**
 * Device-local re-entry prompt decision. Never calls anything: it only says
 * whether a prompt is due. Off by default, at most once per day, and never
 * while the player is already mid-quest.
 */
export function shouldPromptReentry(input: {
  rhythm: RhythmSettings;
  now: Date | number | string;
  hasActiveRun: boolean;
  hasSomethingToDo: boolean;
}): boolean {
  const { rhythm } = input;
  if (!rhythm.reentryEnabled) return false;
  if (input.hasActiveRun) return false;
  if (!input.hasSomethingToDo) return false;
  const slot = currentSlot(input.now);
  if (!rhythm.slots.includes(slot)) return false;
  return rhythm.lastPromptedDay !== localDayKey(input.now);
}
