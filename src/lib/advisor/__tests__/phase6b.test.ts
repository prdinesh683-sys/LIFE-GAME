import { describe, expect, it } from "vitest";

import {
  applyRephrase,
  selectBecause,
  THIN_EVIDENCE_SENTENCE,
  type BecauseInput,
} from "../because";
import { detectPatternCandidates } from "../../memory/pattern-engine";
import { followThroughByWindow, NOT_ENOUGH_EVIDENCE } from "../../memory/follow-through";
import type { QuestRun } from "../../game/types";
import type { TimeWindow } from "../../game/time-window";

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

/** n runs in a slot, `completed` of them finished. */
function runsIn(slot: TimeWindow, total: number, completed: number, name = "Ten push-ups"): QuestRun[] {
  return Array.from({ length: total }, (_, i) =>
    run({
      id: `${slot}-${i}`,
      questName: name,
      windowAtStart: slot,
      outcome: i < completed ? "completed" : "missed",
      missReason: i < completed ? null : "no_time",
      startedAt: new Date(NOW - (i + 1) * 86_400_000).toISOString(),
    }),
  );
}

const base: BecauseInput = { patterns: [], outcomes: [] };

describe("because — deterministic evidence selection", () => {
  it("returns the thin-evidence line when nothing is recorded", () => {
    const reason = selectBecause(base);
    expect(reason.tier).toBe("insufficient");
    expect(reason.sufficient).toBe(false);
    expect(reason.sentence).toBe(THIN_EVIDENCE_SENTENCE);
  });

  it("tier 1 — uses a validated pattern for the current slot", () => {
    const patterns = detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW);
    const reason = selectBecause({ ...base, patterns, slot: "morning" });
    expect(reason.tier).toBe("pattern");
    expect(reason.sentence).toContain("4 of 5");
    expect(reason.evidenceIds.length).toBe(4);
  });

  it("tier 1 — prefers a matching quest pattern over the slot pattern", () => {
    const patterns = detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW);
    const reason = selectBecause({
      ...base,
      patterns,
      slot: "morning",
      questName: "Ten push-ups",
    });
    expect(reason.sentence).toContain("finished this one");
  });

  it("tier 2 — falls back to a measured outcome of the same shape", () => {
    const reason = selectBecause({
      ...base,
      shape: "create_quest",
      outcomes: [
        {
          recommendationId: "rec1",
          shape: "create_quest",
          result: "followed_worked",
          measuredAt: new Date(NOW - 3_600_000).toISOString(),
        },
      ],
    });
    expect(reason.tier).toBe("outcome");
    expect(reason.sentence).toContain("last time you tried this");
  });

  it("tier 3 — falls back to what the player stated in Game setup", () => {
    const reason = selectBecause({
      ...base,
      stated: { priorities: ["Sleep"], goals: ["run a 5k"], constraints: [] },
    });
    expect(reason.tier).toBe("stated");
    expect(reason.sentence).toContain("Sleep");
  });

  it("tier 4 — falls back to an immediate recorded fact", () => {
    const reason = selectBecause({ ...base, facts: ["you have about 15 minutes today"] });
    expect(reason.tier).toBe("fact");
    expect(reason.sentence).toBe("Because you have about 15 minutes today.");
  });

  it("respects the exact priority order", () => {
    const patterns = detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW);
    const full: BecauseInput = {
      patterns,
      slot: "morning",
      shape: "create_quest",
      outcomes: [
        {
          recommendationId: "rec1",
          shape: "create_quest",
          result: "followed_worked",
          measuredAt: new Date(NOW).toISOString(),
        },
      ],
      stated: { priorities: ["Sleep"], goals: [], constraints: [] },
      facts: ["you have about 15 minutes today"],
    };
    expect(selectBecause(full).tier).toBe("pattern");
    expect(selectBecause({ ...full, patterns: [] }).tier).toBe("outcome");
    expect(selectBecause({ ...full, patterns: [], outcomes: [] }).tier).toBe("stated");
    expect(selectBecause({ ...full, patterns: [], outcomes: [], stated: null }).tier).toBe("fact");
  });

  it("is repeatable — identical inputs give an identical sentence", () => {
    const patterns = detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW);
    const input = { ...base, patterns, slot: "morning" as const };
    expect(selectBecause(input).sentence).toBe(selectBecause(input).sentence);
  });

  it("changes when the deterministic evidence genuinely changes", () => {
    const a = detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW);
    const b = detectPatternCandidates(runsIn("morning", 6, 6), [], undefined, NOW);
    const first = selectBecause({ ...base, patterns: a, slot: "morning" }).sentence;
    const second = selectBecause({ ...base, patterns: b, slot: "morning" }).sentence;
    expect(first).not.toBe(second);
  });
});

describe("because — AI may only rephrase", () => {
  const reason = selectBecause({
    ...base,
    patterns: detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW),
    slot: "morning",
  });

  it("accepts a rephrase that keeps the evidence reference", () => {
    const text = "Because mornings work for you — 4 of 5 got done.";
    expect(applyRephrase(reason, text)).toBe(text);
  });

  it("rejects a rephrase that drops the evidence", () => {
    expect(applyRephrase(reason, "Because mornings feel better.")).toBe(reason.sentence);
  });

  it("rejects an invented reason and an empty rephrase", () => {
    expect(applyRephrase(reason, "You should really do this now.")).toBe(reason.sentence);
    expect(applyRephrase(reason, "   ")).toBe(reason.sentence);
  });

  it("never rephrases the thin-evidence line", () => {
    const thin = selectBecause(base);
    expect(applyRephrase(thin, "Because mornings work for you.")).toBe(THIN_EVIDENCE_SENTENCE);
  });

  it("offline / AI-off keeps the deterministic sentence", () => {
    expect(applyRephrase(reason, null)).toBe(reason.sentence);
    expect(applyRephrase(reason, undefined)).toBe(reason.sentence);
  });
});

describe("follow-through — projection over existing pattern candidates", () => {
  it("says 'not enough evidence yet' below the minimum sample", () => {
    const summary = followThroughByWindow(
      detectPatternCandidates(runsIn("morning", 2, 2), [], undefined, NOW),
    );
    expect(summary.hasEvidence).toBe(false);
    expect(summary.headline).toBe(NOT_ENOUGH_EVIDENCE);
  });

  it("names a slot with a 4 of 5 record", () => {
    const summary = followThroughByWindow(
      detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW),
    );
    expect(summary.best?.label).toBe("Morning — 4 of 5 completed");
    expect(summary.best?.percent).toBe(80);
  });

  it("ranks multiple slots and never invents one", () => {
    const runs = [...runsIn("morning", 4, 4), ...runsIn("evening", 4, 1)];
    const summary = followThroughByWindow(detectPatternCandidates(runs, [], undefined, NOW));
    expect(summary.slots.map((s) => s.slot)).toEqual(["morning", "evening"]);
    expect(summary.slots.some((s) => s.slot === "afternoon")).toBe(false);
  });

  it("keeps a slot below three finished runs unnamed", () => {
    const runs = [...runsIn("morning", 5, 5), ...runsIn("evening", 2, 2)];
    const summary = followThroughByWindow(detectPatternCandidates(runs, [], undefined, NOW));
    expect(summary.slots.map((s) => s.slot)).toEqual(["morning"]);
  });

  it("matches the underlying pattern-engine counts exactly", () => {
    const candidates = detectPatternCandidates(runsIn("morning", 5, 4), [], undefined, NOW);
    const engine = candidates.find((c) => c.id === "time:morning")!;
    const projected = followThroughByWindow(candidates).slots[0]!;
    expect(projected.completed).toBe(engine.recurrence);
    expect(projected.total).toBe(engine.samples);
  });
});

describe("miss and recovery stay connected to learning", () => {
  const missed = run({
    id: "miss-1",
    outcome: "missed",
    missReason: "no_time",
    missNote: "ran out of day",
  });
  const recovery = run({ id: "rec-1", outcome: "completed", recoveryOfRunId: "miss-1" });

  it("keeps the miss reason on the run", () => {
    expect(missed.missReason).toBe("no_time");
    expect(missed.missNote).toBe("ran out of day");
  });

  it("keeps the recovery link after the second attempt", () => {
    expect(recovery.recoveryOfRunId).toBe("miss-1");
  });

  it("feeds the miss reason into the existing pattern pipeline", () => {
    const runs = [
      ...runsIn("morning", 5, 2),
      run({ id: "m9", outcome: "missed", missReason: "no_time" }),
    ];
    const ids = detectPatternCandidates(runs, [], undefined, NOW).map((c) => c.id);
    expect(ids).toContain("miss:no_time");
  });

  it("distinguishes a completed recovery from the original miss", () => {
    const runs = [...runsIn("morning", 5, 3), missed, recovery];
    const candidates = detectPatternCandidates(runs, [], undefined, NOW);
    const rec = candidates.find((c) => c.id === "recovery");
    expect(rec).toBeTruthy();
    expect(rec!.evidenceIds).toContain("rec-1");
    expect(rec!.contradictionIds).not.toContain("rec-1");
  });
});
