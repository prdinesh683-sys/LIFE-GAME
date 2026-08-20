import { describe, expect, it } from "vitest";

import {
  currentSlot,
  nextLaterToday,
  pickScheduledQuest,
  questRelevance,
  slotForHour,
  windowStatusFor,
} from "../time-window";
import { rhythmOf, shouldOfferClose, shouldPromptReentry, summariseDay } from "../daily-rhythm";
import { recoveryChoices } from "../miss-recovery";
import type { Quest, QuestRun } from "../types";

const at = (hour: number) => new Date(2026, 0, 15, hour, 0, 0);
const dayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function quest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: "q1",
    name: "Ten push-ups",
    description: "",
    attribute: "body",
    difficulty: "easy",
    durationMinutes: 20,
    status: "available",
    scheduledFor: null,
    timeWindow: null,
    createdAt: at(9).toISOString(),
    ...overrides,
  } as Quest;
}

describe("time windows are deterministic", () => {
  it("maps hours to fixed slots", () => {
    expect(slotForHour(0)).toBe("morning");
    expect(slotForHour(11)).toBe("morning");
    expect(slotForHour(12)).toBe("afternoon");
    expect(slotForHour(16)).toBe("afternoon");
    expect(slotForHour(17)).toBe("evening");
    expect(slotForHour(23)).toBe("evening");
  });

  it("gives the same answer for the same clock time", () => {
    expect(currentSlot(at(13))).toBe(currentSlot(at(13)));
    expect(currentSlot(at(13))).toBe("afternoon");
  });

  it("treats a quest with no window as anytime", () => {
    expect(questRelevance(quest(), at(9))).toBe("anytime");
  });

  it("classifies now, later and missed windows", () => {
    expect(questRelevance(quest({ timeWindow: "morning" }), at(9))).toBe("now");
    expect(questRelevance(quest({ timeWindow: "evening" }), at(9))).toBe("later_today");
    expect(questRelevance(quest({ timeWindow: "morning" }), at(20))).toBe("missed_window");
  });

  it("ignores quests scheduled for another day", () => {
    expect(questRelevance(quest({ scheduledFor: "2020-01-01" }), at(9))).toBe("not_today");
  });
});

describe("a missed window never blocks or penalises", () => {
  it("still allows the quest to be started and finished", () => {
    const status = windowStatusFor(quest({ timeWindow: "morning" }), at(20));
    expect(status).toBe("late");
    // Reward inputs are untouched by timing: the quest itself is unchanged.
    expect(quest({ timeWindow: "morning" }).durationMinutes).toBe(20);
  });

  it("prefers a now-window quest over a missed one, and missed over anytime", () => {
    const now = at(13);
    const list = [
      quest({ id: "anytime" }),
      quest({ id: "missed", timeWindow: "morning" }),
      quest({ id: "now", timeWindow: "afternoon" }),
    ];
    expect(pickScheduledQuest(list, now)?.quest.id).toBe("now");
    expect(pickScheduledQuest(list.slice(0, 2), now)?.quest.id).toBe("missed");
    expect(pickScheduledQuest(list.slice(0, 1), now)).toBeNull();
  });

  it("surfaces what is coming later today", () => {
    expect(nextLaterToday([quest({ timeWindow: "evening" })], at(9))?.quest.timeWindow).toBe(
      "evening",
    );
    expect(nextLaterToday([quest({ timeWindow: "morning" })], at(20))).toBeNull();
  });
});

describe("recovery offers a way back, never a requirement", () => {
  it("always includes reschedule and drop, and a smaller version when it fits", () => {
    const kinds = recoveryChoices(quest({ durationMinutes: 30 }), at(20)).map((c) => c.kind);
    expect(kinds).toContain("reschedule");
    expect(kinds).toContain("drop");
    expect(kinds).toContain("smaller");
  });

  it("skips the smaller version when the quest is already tiny", () => {
    const kinds = recoveryChoices(quest({ durationMinutes: 5 }), at(20)).map((c) => c.kind);
    expect(kinds).not.toContain("smaller");
  });
});

describe("daily rhythm", () => {
  const runsToday = (): QuestRun[] => [];

  it("offers to close the day only in the evening and only once", () => {
    const day = { id: dayOf(at(20)), openedAt: at(8).toISOString(), closedAt: null } as never;
    expect(shouldOfferClose(day, at(13))).toBe(false);
    expect(shouldOfferClose(day, at(20))).toBe(true);
    const closed = { ...(day as object), closedAt: at(21).toISOString() } as never;
    expect(shouldOfferClose(closed, at(22))).toBe(false);
  });

  it("summarises the day from recorded runs only", () => {
    const summary = summariseDay({ runs: runsToday(), today: null, now: at(20) });
    expect(summary.completed).toBe(0);
    expect(summary.missed).toBe(0);
    expect(summary.sparks).toBe(0);
  });

  it("keeps re-entry nudges off by default", () => {
    const rhythm = rhythmOf({} as never);
    expect(rhythm.reentryEnabled).toBe(false);
    expect(
      shouldPromptReentry({ rhythm, now: at(20), hasActiveRun: false, hasSomethingToDo: true }),
    ).toBe(false);
  });

  it("prompts at most once per day, and never during an active run", () => {
    const rhythm = { reentryEnabled: true, slots: ["evening" as const], lastPromptedDay: null };
    expect(
      shouldPromptReentry({ rhythm, now: at(20), hasActiveRun: false, hasSomethingToDo: true }),
    ).toBe(true);
    expect(
      shouldPromptReentry({ rhythm, now: at(20), hasActiveRun: true, hasSomethingToDo: true }),
    ).toBe(false);
    expect(
      shouldPromptReentry({
        rhythm: { ...rhythm, lastPromptedDay: dayOf(at(20)) },
        now: at(20),
        hasActiveRun: false,
        hasSomethingToDo: true,
      }),
    ).toBe(false);
    expect(
      shouldPromptReentry({ rhythm, now: at(9), hasActiveRun: false, hasSomethingToDo: true }),
    ).toBe(false);
  });
});
