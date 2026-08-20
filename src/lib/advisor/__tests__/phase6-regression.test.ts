import { describe, expect, it } from "vitest";

import { selectBecause, THIN_EVIDENCE_SENTENCE } from "../because";
import { detectPatternCandidates } from "../../memory/pattern-engine";
import { followThroughByWindow, NOT_ENOUGH_EVIDENCE } from "../../memory/follow-through";
import {
  currentSlot,
  pickScheduledQuest,
  questRelevance,
  relevanceTier,
  isCompletableToday,
  windowStatusFor,
} from "../../game/time-window";
import type { TimeWindow } from "../../game/time-window";
import type { QuestRun } from "../../game/types";

/**
 * PHASE 6 REGRESSION — 6A (time & rhythm) and 6B (visible learning) together,
 * driven through the real pipeline: recorded runs → pattern engine →
 * deterministic "because" selection / follow-through projection.
 *
 * The fixtures below are a *mature history*: enough finished runs to cross the
 * production thresholds without weeks of real data. No threshold is relaxed.
 */

const NOW = new Date(2026, 0, 15, 9, 0, 0).getTime();

function run(overrides: Partial<QuestRun> = {}): QuestRun {
  return {
    id: `r${Math.random().toString(36).slice(2, 8)}`,
    questId: "q1",
    questName: "Ten push-ups",
    startedAt: new Date(NOW - 86_400_000).toISOString(),
    endedAt: new Date(NOW - 86_000_000).toISOString(),
    outcome: "completed",
    verification: "self",
    sparksAwarded: 10,
    comboAtCompletion: 1,
    rushRequested: false,
    rushHit: null,
    missReason: null,
    missNote: null,
    energyAtStart: 3,
    moodAtStart: 3,
    momentumAtStart: 50,
    windowAtStart: "morning",
    windowStatus: "on_time",
    recoveryOfRunId: null,
    ...overrides,
  } as QuestRun;
}

/** A realistic history: `total` runs in a slot, `completed` of them finished. */
function history(slot: TimeWindow, total: number, completed: number, name = "Ten push-ups"): QuestRun[] {
  return Array.from({ length: total }, (_, i) =>
    run({
      id: `${slot}-${name}-${i}`,
      questName: name,
      windowAtStart: slot,
      outcome: i < completed ? "completed" : "missed",
      missReason: i < completed ? null : "no_time",
      startedAt: new Date(NOW - (i + 1) * 86_400_000).toISOString(),
    }),
  );
}

describe("phase 6 — mature history through the real pipeline", () => {
  it("surfaces a pattern-backed because line once the threshold is crossed", () => {
    const runs = history("morning", 8, 7);
    const patterns = detectPatternCandidates(runs, [], undefined, NOW);
    const slotPattern = patterns.find((p) => p.id === "time:morning")!;
    expect(slotPattern.validated).toBe(true);

    const reason = selectBecause({ patterns, outcomes: [], slot: "morning" });
    expect(reason.tier).toBe("pattern");
    expect(reason.sufficient).toBe(true);
    // References the *actual* recorded counts, not a rounded claim.
    expect(reason.evidenceRef).toBe(`${slotPattern.recurrence} of ${slotPattern.samples}`);
    expect(reason.sentence).toContain(reason.evidenceRef);
    expect(reason.evidenceIds).toEqual(slotPattern.evidenceIds);
  });

  it("changes the line when the underlying evidence changes", () => {
    const before = selectBecause({
      patterns: detectPatternCandidates(history("morning", 8, 7), [], undefined, NOW),
      outcomes: [],
      slot: "morning",
    });
    const after = selectBecause({
      patterns: detectPatternCandidates(history("morning", 9, 9), [], undefined, NOW),
      outcomes: [],
      slot: "morning",
    });
    expect(after.sentence).not.toBe(before.sentence);
    expect(after.tier).toBe("pattern");
  });

  it("returns to the thin-evidence state when the evidence is removed", () => {
    const thin = selectBecause({
      patterns: detectPatternCandidates(history("morning", 2, 2), [], undefined, NOW),
      outcomes: [],
      slot: "morning",
    });
    expect(thin.tier).toBe("insufficient");
    expect(thin.sentence).toBe(THIN_EVIDENCE_SENTENCE);
    expect(selectBecause({ patterns: [], outcomes: [], slot: "morning" }).sentence).toBe(
      THIN_EVIDENCE_SENTENCE,
    );
  });

  it("follow-through mirrors the same evidence, and stays quiet below the minimum", () => {
    const runs = [...history("morning", 8, 7), ...history("evening", 6, 2, "Read"), ...history("afternoon", 2, 2, "Walk")];
    const summary = followThroughByWindow(detectPatternCandidates(runs, [], undefined, NOW));
    expect(summary.hasEvidence).toBe(true);
    expect(summary.best?.slot).toBe("morning");
    expect(summary.best?.completed).toBe(7);
    expect(summary.best?.total).toBe(8);
    // Afternoon has only two runs — it is never named.
    expect(summary.slots.some((s) => s.slot === "afternoon")).toBe(false);
    expect(followThroughByWindow([]).headline).toBe(NOT_ENOUGH_EVIDENCE);
  });

  it("keeps miss reasons and recovery links inside the learning pipeline", () => {
    const missed = run({ id: "miss-1", outcome: "missed", missReason: "no_time", missNote: "ran late" });
    const recovered = run({ id: "rec-1", outcome: "completed", recoveryOfRunId: "miss-1" });
    const candidates = detectPatternCandidates(
      [...history("morning", 6, 3), missed, recovered],
      [],
      undefined,
      NOW,
    );
    expect(candidates.map((c) => c.id)).toContain("miss:no_time");
    const recovery = candidates.find((c) => c.id === "recovery")!;
    expect(recovery.evidenceIds).toContain("rec-1");
    expect(missed.missReason).toBe("no_time");
    expect(missed.missNote).toBe("ran late");
  });
});

describe("phase 6a — time & rhythm boundaries stay deterministic", () => {
  it("maps hours to the locked slot boundaries", () => {
    expect(currentSlot(new Date(2026, 0, 15, 0, 0))).toBe("morning");
    expect(currentSlot(new Date(2026, 0, 15, 11, 59))).toBe("morning");
    expect(currentSlot(new Date(2026, 0, 15, 12, 0))).toBe("afternoon");
    expect(currentSlot(new Date(2026, 0, 15, 16, 59))).toBe("afternoon");
    expect(currentSlot(new Date(2026, 0, 15, 17, 0))).toBe("evening");
    expect(currentSlot(new Date(2026, 0, 15, 23, 59))).toBe("evening");
  });

  it("treats an unwindowed quest as anytime and never demotes it", () => {
    expect(questRelevance({}, NOW)).toBe("anytime");
    expect(windowStatusFor({}, NOW)).toBe("unscheduled");
  });

  it("honours scheduledFor for another day", () => {
    expect(questRelevance({ timeWindow: "morning", scheduledFor: "2026-01-16" }, NOW)).toBe("not_today");
  });

  it("a missed window is not a miss — it only loses priority", () => {
    const afternoon = new Date(2026, 0, 15, 14, 0).getTime();
    const relevance = questRelevance({ timeWindow: "morning" }, afternoon);
    expect(relevance).toBe("missed_window");
    expect(isCompletableToday(relevance)).toBe(true);
    expect(relevanceTier("now")).toBeLessThan(relevanceTier("missed_window"));
    expect(relevanceTier("missed_window")).toBeLessThan(relevanceTier("anytime"));
    expect(relevanceTier("anytime")).toBeLessThan(relevanceTier("later_today"));
  });

  it("Today picks the current-window quest over a passed one, and never reschedules", () => {
    const afternoon = new Date(2026, 0, 15, 14, 0).getTime();
    const quests = [{ timeWindow: "morning" as const }, { timeWindow: "afternoon" as const }];
    const pick = pickScheduledQuest(quests, afternoon)!;
    expect(pick.quest.timeWindow).toBe("afternoon");
    // Selection is read-only: the inputs are untouched.
    expect(quests).toEqual([{ timeWindow: "morning" }, { timeWindow: "afternoon" }]);
  });
});
