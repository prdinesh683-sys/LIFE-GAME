/**
 * Time windows (Phase 6A).
 *
 * The single definition of "morning / afternoon / evening" for the whole app.
 * The pattern engine imports the same slots, so what the game schedules and
 * what the game learns can never drift apart.
 *
 * Rules that cannot be bent:
 * - a quest without a window is `anytime` and is never demoted or nudged;
 * - a missed window is NOT a miss: it touches no run, combo or Spark;
 * - every function takes an explicit `now`. No ambient clock lives in here.
 */

export type TimeWindow = "morning" | "afternoon" | "evening";

export const TIME_WINDOWS: TimeWindow[] = ["morning", "afternoon", "evening"];

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

/** Inclusive start hour, exclusive end hour, in local device time. */
export const TIME_WINDOW_HOURS: Record<TimeWindow, [number, number]> = {
  morning: [0, 12],
  afternoon: [12, 17],
  evening: [17, 24],
};

export const TIME_WINDOW_HINTS: Record<TimeWindow, string> = {
  morning: "before noon",
  afternoon: "noon to 5pm",
  evening: "after 5pm",
};

/** How a scheduled quest relates to the current moment. */
export type WindowRelevance = "now" | "later_today" | "missed_window" | "anytime" | "not_today";

/** How a run started relative to its quest's window. */
export type WindowStatus = "on_time" | "late" | "unscheduled";

export interface ScheduledLike {
  timeWindow?: TimeWindow | null;
  scheduledFor?: string | null;
}

export function slotForHour(hour: number): TimeWindow {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** Current slot from an explicit clock value (Date, epoch ms or ISO string). */
export function currentSlot(now: Date | number | string): TimeWindow {
  return slotForHour(toDate(now).getHours());
}

export function slotIndex(slot: TimeWindow): number {
  return TIME_WINDOWS.indexOf(slot);
}

/** Local day key (YYYY-MM-DD) for an explicit clock value. */
export function localDayKey(now: Date | number | string): string {
  const date = toDate(now);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nextDayKey(now: Date | number | string): string {
  const date = toDate(now);
  // Noon avoids DST-shift days collapsing or skipping a date.
  const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12, 0, 0, 0);
  return localDayKey(tomorrow);
}

/** Slots still ahead today, in order. Empty during the evening. */
export function laterSlotsToday(now: Date | number | string): TimeWindow[] {
  const index = slotIndex(currentSlot(now));
  return TIME_WINDOWS.slice(index + 1);
}

/**
 * Deterministic relevance of a quest at `now`.
 *
 * - a date set for another day → `not_today`, whatever the window says;
 * - no window → `anytime`;
 * - same slot → `now`; a later slot → `later_today`; an earlier slot → `missed_window`.
 */
export function questRelevance(quest: ScheduledLike, now: Date | number | string): WindowRelevance {
  const scheduledDay = dayOf(quest.scheduledFor);
  if (scheduledDay && scheduledDay !== localDayKey(now)) return "not_today";

  const window = quest.timeWindow ?? null;
  if (!window) return "anytime";

  const current = slotIndex(currentSlot(now));
  const target = slotIndex(window);
  if (target === current) return "now";
  if (target > current) return "later_today";
  return "missed_window";
}

/**
 * Ordering tier for the Today front door. Lower sorts first.
 * 0 is reserved for an active run, which Today handles before this runs.
 */
export function relevanceTier(relevance: WindowRelevance): number {
  switch (relevance) {
    case "now":
      return 1;
    case "missed_window":
      return 2;
    case "anytime":
      return 3;
    case "later_today":
      return 4;
    default:
      return 5;
  }
}

/** A missed window is still completable today — it only loses priority. */
export function isCompletableToday(relevance: WindowRelevance): boolean {
  return relevance === "now" || relevance === "missed_window" || relevance === "anytime";
}

/** Recorded on the run, never used in reward or momentum maths. */
export function windowStatusFor(quest: ScheduledLike, now: Date | number | string): WindowStatus {
  if (!quest.timeWindow) return "unscheduled";
  const relevance = questRelevance(quest, now);
  if (relevance === "missed_window" || relevance === "not_today") return "late";
  return "on_time";
}

export interface WindowPick<T extends ScheduledLike> {
  quest: T;
  relevance: WindowRelevance;
}

/**
 * Picks the single windowed quest that should own Today right now.
 * Only `now` and `missed_window` qualify — `anytime` work stays with the
 * existing advisor/recommendation ranking, and ties keep the incoming order.
 */
export function pickScheduledQuest<T extends ScheduledLike>(
  quests: T[],
  now: Date | number | string,
): WindowPick<T> | null {
  let best: WindowPick<T> | null = null;
  for (const quest of quests) {
    const relevance = questRelevance(quest, now);
    if (relevance !== "now" && relevance !== "missed_window") continue;
    if (!best || relevanceTier(relevance) < relevanceTier(best.relevance)) {
      best = { quest, relevance };
    }
  }
  return best;
}

/** The next windowed quest waiting later today, for an honest empty state. */
export function nextLaterToday<T extends ScheduledLike>(
  quests: T[],
  now: Date | number | string,
): WindowPick<T> | null {
  let best: WindowPick<T> | null = null;
  for (const quest of quests) {
    if (questRelevance(quest, now) !== "later_today") continue;
    const window = quest.timeWindow as TimeWindow;
    if (!best || slotIndex(window) < slotIndex(best.quest.timeWindow as TimeWindow)) {
      best = { quest, relevance: "later_today" };
    }
  }
  return best;
}

export function relevanceLabel(relevance: WindowRelevance): string {
  switch (relevance) {
    case "now":
      return "Right on time";
    case "later_today":
      return "Later today";
    case "missed_window":
      return "Window passed — still fine to do";
    case "not_today":
      return "Another day";
    default:
      return "Anytime";
  }
}

function toDate(now: Date | number | string): Date {
  if (now instanceof Date) return now;
  if (typeof now === "number") return new Date(now);
  return new Date(Date.parse(now));
}

function dayOf(scheduledFor: string | null | undefined): string | null {
  if (!scheduledFor) return null;
  return scheduledFor.slice(0, 10);
}
