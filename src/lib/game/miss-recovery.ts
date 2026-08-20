/**
 * Miss recovery (Phase 6A).
 *
 * A miss is the most informative moment in the game, so it ends with a way
 * back instead of a dead end. Everything here is a pure function: it returns
 * the *intended* writes, and the store performs them through the existing
 * repository path. No new workflow, no new route, no new permission class.
 */

import {
  laterSlotsToday,
  localDayKey,
  nextDayKey,
  TIME_WINDOW_LABELS,
  type TimeWindow,
} from "./time-window";
import type { QuestDraft } from "./quest-engine";
import type { Quest, QuestRun } from "./types";

export type RecoveryKind = "smaller" | "reschedule" | "drop";

export interface RecoveryChoice {
  kind: RecoveryKind;
  label: string;
  detail: string;
}

/** Smaller versions never go below five real minutes. */
export const SMALLER_MIN_MINUTES = 5;
/** Below this there is nothing left to halve. */
export const SMALLER_ELIGIBLE_MINUTES = 10;

export function smallerDuration(durationMinutes: number): number {
  return Math.max(SMALLER_MIN_MINUTES, Math.floor(durationMinutes / 2));
}

export function canOfferSmaller(quest: Pick<Quest, "durationMinutes">): boolean {
  return quest.durationMinutes >= SMALLER_ELIGIBLE_MINUTES;
}

/** Where a reschedule lands: a later slot today, otherwise tomorrow morning. */
export function rescheduleTarget(now: Date | number | string): {
  timeWindow: TimeWindow;
  dayKey: string;
  sameDay: boolean;
} {
  const later = laterSlotsToday(now);
  const next = later[0];
  if (next) return { timeWindow: next, dayKey: localDayKey(now), sameDay: true };
  return { timeWindow: "morning", dayKey: nextDayKey(now), sameDay: false };
}

/** The legal choices for this miss — never more than three, always at least one. */
export function recoveryChoices(
  quest: Pick<Quest, "durationMinutes">,
  now: Date | number | string,
): RecoveryChoice[] {
  const choices: RecoveryChoice[] = [];

  if (canOfferSmaller(quest)) {
    choices.push({
      kind: "smaller",
      label: "Do a smaller version",
      detail: `${smallerDuration(quest.durationMinutes)} minutes instead of ${quest.durationMinutes}.`,
    });
  }

  const target = rescheduleTarget(now);
  choices.push({
    kind: "reschedule",
    label: target.sameDay
      ? `Move it to ${TIME_WINDOW_LABELS[target.timeWindow].toLowerCase()}`
      : "Move it to tomorrow morning",
    detail: target.sameDay
      ? "Same quest, later today."
      : "Same quest, first thing tomorrow.",
  });

  choices.push({
    kind: "drop",
    label: "Drop it for today",
    detail: "It stays in your list for another day.",
  });

  return choices;
}

/** A smaller retry, linked back to the run it came from. */
export function planSmallerVersion(input: {
  quest: Quest;
  run: Pick<QuestRun, "id">;
}): { draft: QuestDraft; recoveryOfRunId: string } {
  const duration = smallerDuration(input.quest.durationMinutes);
  return {
    recoveryOfRunId: input.run.id,
    draft: {
      name: `${input.quest.name} — smaller version`,
      description: input.quest.description,
      category: input.quest.category,
      durationMinutes: duration,
      difficulty: input.quest.difficulty,
      attribute: input.quest.attribute,
      destinationId: input.quest.destinationId,
      boostId: input.quest.boostId,
      isRecovery: true,
      createdBy: "engine",
      // Sparks are recomputed by the reward engine from this duration.
      timeWindow: null,
    },
  };
}

/** Everything unrelated to timing is preserved exactly. */
export function planReschedule(
  quest: Quest,
  now: Date | number | string,
): { quest: Quest; sameDay: boolean; timeWindow: TimeWindow } {
  const target = rescheduleTarget(now);
  return {
    sameDay: target.sameDay,
    timeWindow: target.timeWindow,
    quest: {
      ...quest,
      status: "available",
      scheduledFor: target.dayKey,
      timeWindow: target.timeWindow,
    },
  };
}

/** Today only: the quest comes back tomorrow, untouched otherwise. */
export function planDropForToday(quest: Quest, now: Date | number | string): { quest: Quest } {
  return {
    quest: {
      ...quest,
      status: "available",
      scheduledFor: nextDayKey(now),
      timeWindow: quest.timeWindow ?? null,
    },
  };
}
