import { describe, expect, it } from "vitest";

import { DEFAULT_ECONOMY } from "../config";
import { computeMomentum, momentumLabel } from "../momentum-engine";
import { advanceRun, dayKey } from "../run-engine";
import {
  canTransition,
  inferQuestType,
  materialiseQuest,
  rushDeadline,
  validateDraft,
} from "../quest-engine";
import {
  comboMultiplier,
  nextCombo,
  rankForLifetimeSparks,
  rankProgress,
  resolveReward,
  sparksForQuest,
} from "../reward-engine";
import { detectPatterns } from "../behavior-engine";
import { proposeBlueprint } from "../blueprint-parser";
import type { ActivityEvent, Profile, QuestRun } from "../types";

const config = DEFAULT_ECONOMY;

const profile: Profile = {
  id: "profile",
  displayName: "Player",
  title: "Starter",
  avatarSeed: "seed",
  chapter: "Chapter 1",
  comboUpdatedAt: null,
  name: "Player",
  rank: 1,
  sparks: 0,
  lifetimeSparks: 0,
  combo: 1,
  currentRun: 3,
  bestRun: 5,
  lastActiveDay: "2026-03-09",
  lastCompletionAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
} as Profile;

describe("reward engine", () => {
  it("scales sparks with duration and difficulty", () => {
    expect(sparksForQuest(config, 30, "normal")).toBeGreaterThan(sparksForQuest(config, 10, "normal"));
    expect(sparksForQuest(config, 30, "hard")).toBeGreaterThan(sparksForQuest(config, 30, "normal"));
  });

  it("never pays zero sparks", () => {
    expect(sparksForQuest(config, 1, "easy")).toBeGreaterThanOrEqual(1);
  });

  it("caps the combo multiplier", () => {
    expect(comboMultiplier(config, 1)).toBe(1);
    expect(comboMultiplier(config, 999)).toBe(config.comboMaxMultiplier);
  });

  it("resets the combo once the window lapses", () => {
    const now = "2026-03-10T12:00:00.000Z";
    expect(nextCombo(config, 4, "2026-03-10T11:59:00.000Z", now)).toBe(5);
    expect(nextCombo(config, 4, "2026-03-09T12:00:00.000Z", now)).toBe(1);
    expect(nextCombo(config, 4, null, now)).toBe(1);
  });

  it("advances rank monotonically with lifetime sparks", () => {
    expect(rankForLifetimeSparks(config, 0)).toBe(1);
    const high = rankForLifetimeSparks(config, 100000);
    expect(high).toBeGreaterThan(1);
    expect(rankForLifetimeSparks(config, 200000)).toBeGreaterThanOrEqual(high);
  });

  it("reports rank progress inside bounds", () => {
    const progress = rankProgress(config, 250);
    expect(progress.ratio).toBeGreaterThanOrEqual(0);
    expect(progress.ratio).toBeLessThanOrEqual(1);
    expect(progress.intoRank).toBeLessThanOrEqual(progress.needed);
  });

  it("resolves a full reward deterministically", () => {
    const args = {
      config,
      profile,
      durationMinutes: 25,
      difficulty: "normal" as const,
      lastCompletionIso: "2026-03-10T11:50:00.000Z",
      nowIso: "2026-03-10T12:00:00.000Z",
    };
    const first = resolveReward(args);
    const second = resolveReward(args);
    expect(first).toEqual(second);
    expect(first.totalSparks).toBeGreaterThan(0);
  });
});

describe("run engine", () => {
  it("extends the run on a consecutive day", () => {
    const outcome = advanceRun(config, profile, "2026-03-10");
    expect(outcome.currentRun).toBe(4);
  });

  it("does nothing twice on the same day", () => {
    const outcome = advanceRun(config, { ...profile, lastActiveDay: "2026-03-10" }, "2026-03-10");
    expect(outcome.currentRun).toBe(profile.currentRun);
    expect(outcome.extended).toBe(false);
  });

  it("survives a missed day inside the grace window", () => {
    const outcome = advanceRun(config, profile, "2026-03-11");
    expect(outcome.currentRun).toBe(4);
    expect(outcome.recovered).toBe(true);
  });

  it("restarts after a long absence but keeps the best run", () => {
    const outcome = advanceRun(config, profile, "2026-04-20");
    expect(outcome.currentRun).toBe(1);
    expect(outcome.bestRun).toBe(5);
  });

  it("produces a stable local day key", () => {
    expect(dayKey(new Date(2026, 2, 9))).toBe("2026-03-09");
  });
});

describe("momentum engine", () => {
  const now = "2026-03-10T12:00:00.000Z";
  const event = (type: ActivityEvent["type"], hoursAgo: number): ActivityEvent =>
    ({
      id: `e-${type}-${hoursAgo}`,
      type,
      timestamp: new Date(Date.parse(now) - hoursAgo * 3600000).toISOString(),
      payload: {},
    }) as ActivityEvent;

  it("is dormant with no activity", () => {
    const result = computeMomentum({ config, events: [], today: null, nowIso: now });
    expect(result.value).toBe(0);
    expect(momentumLabel(result.value)).toBe("Dormant");
  });

  it("rises with recent completions", () => {
    const result = computeMomentum({
      config,
      events: [event("quest_completed", 1), event("quest_completed", 2)],
      today: null,
      nowIso: now,
    });
    expect(result.completions).toBe(2);
    expect(result.value).toBeGreaterThan(0);
  });

  it("ignores activity older than the 72h window", () => {
    const result = computeMomentum({
      config,
      events: [event("quest_completed", 100)],
      today: null,
      nowIso: now,
    });
    expect(result.completions).toBe(0);
    expect(result.value).toBe(0);
  });

  it("stays inside 0-100", () => {
    const many = Array.from({ length: 60 }, (_, i) => event("quest_completed", i * 0.5));
    const result = computeMomentum({ config, events: many, today: null, nowIso: now });
    expect(result.value).toBeLessThanOrEqual(100);
    expect(result.value).toBeGreaterThanOrEqual(0);
  });
});

describe("quest engine", () => {
  it("classifies quests by duration", () => {
    expect(inferQuestType(5)).toBe("quick");
    expect(inferQuestType(25)).toBe("normal");
    expect(inferQuestType(45)).toBe("focus");
    expect(inferQuestType(120)).toBe("epic");
  });

  it("rejects unusable drafts", () => {
    expect(validateDraft({ name: "", durationMinutes: 20 }).ok).toBe(false);
    expect(validateDraft({ name: "Run", durationMinutes: 0 }).ok).toBe(false);
    expect(validateDraft({ name: "Run", durationMinutes: 600 }).ok).toBe(false);
    expect(validateDraft({ name: "Run 3km", durationMinutes: 20 }).ok).toBe(true);
  });

  it("holds AI-proposed quests for approval", () => {
    const now = "2026-03-10T12:00:00.000Z";
    const ai = materialiseQuest(config, { name: "AI quest", durationMinutes: 20, aiGenerated: true }, now);
    const mine = materialiseQuest(config, { name: "My quest", durationMinutes: 20 }, now);
    expect(ai.approved).toBe(false);
    expect(mine.approved).toBe(true);
  });

  it("refuses to materialise an invalid draft", () => {
    expect(() => materialiseQuest(config, { name: "", durationMinutes: 20 }, "2026-03-10T12:00:00.000Z")).toThrow();
  });

  it("guards the status lifecycle", () => {
    expect(canTransition("available", "active")).toBe(true);
    expect(canTransition("completed", "active")).toBe(false);
    expect(canTransition("archived", "available")).toBe(false);
  });

  it("computes a rush deadline only for rush windows", () => {
    const now = "2026-03-10T12:00:00.000Z";
    const rush = materialiseQuest(config, { name: "Rush", durationMinutes: 5, rushWindowSeconds: 60 }, now);
    expect(rushDeadline(rush, now)).toBe(Date.parse(now) + 60000);
    const normal = materialiseQuest(config, { name: "Normal", durationMinutes: 20 }, now);
    expect(rushDeadline(normal, now)).toBeNull();
  });
});

describe("behavior engine", () => {
  it("finds nothing in an empty history", () => {
    expect(detectPatterns([], [])).toEqual([]);
  });

  it("surfaces a repeated miss reason", () => {
    const runs: QuestRun[] = Array.from({ length: 4 }, (_, i) => ({
      id: `run-${i}`,
      questId: "q1",
      questName: "Evening run",
      startedAt: `2026-03-0${i + 1}T20:00:00.000Z`,
      endedAt: `2026-03-0${i + 1}T20:30:00.000Z`,
      outcome: "missed",
      missReason: "too_tired",
      missNote: null,
      sparksAwarded: 0,
    }) as QuestRun);
    const patterns = detectPatterns(runs, []);
    expect(patterns.length).toBeGreaterThan(0);
  });
});

describe("blueprint parser", () => {
  it("turns a description into an approvable proposal", () => {
    const proposal = proposeBlueprint("I want to get fit, read more and sleep earlier");
    expect(proposal.goals.length).toBeGreaterThan(0);
    expect(proposal.direction.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same input and variant", () => {
    expect(proposeBlueprint("run every morning", 0)).toEqual(proposeBlueprint("run every morning", 0));
  });
});
