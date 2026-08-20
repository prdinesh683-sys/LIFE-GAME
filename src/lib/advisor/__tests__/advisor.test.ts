import { describe, expect, it } from "vitest";

import { DEFAULT_ECONOMY } from "../../game/config";
import type {
  DailyState,
  GameSnapshot,
  Profile,
  QuestRun,
  Settings,
} from "../../game/types";
import { dayKey } from "../../game/run-engine";
import { buildAdvisorFacts } from "../advisor-facts";
import { detectTriggers } from "../advisor-triggers";
import { scoreEvidence, resolveConfidence, evidenceFromTrigger } from "../advisor-evidence";
import { assembleRecommendations, localDrafts, signatureFor } from "../advisor-engine";
import { checkStale, validateRecommendation } from "../advisor-validation";
import { isDueForMeasurement, measureOutcome, summariseOutcomes } from "../advisor-outcomes";
import {
  detectMaterialChanges,
  isMaterialChange,
  materialSnapshotOf,
  suppressedSignatures,
} from "../advisor-feedback";
import type { RecommendationRecord } from "../advisor-types";

const iso = (offsetHours: number) => new Date(Date.now() - offsetHours * 3_600_000).toISOString();

function makeSettings(): Settings {
  return {
    id: "settings",
    deviceId: "device-test",
    onboardingComplete: true,
    theme: "dark",
    reducedMotion: false,
    sound: true,
    economy: DEFAULT_ECONOMY,
    ai: {
      mode: "off",
      phoneLocal: { enabled: false, endpoint: "", model: "", apiKey: "" },
      ollama: { enabled: false, endpoint: "", model: "", apiKey: "" },
      cloud: { enabled: false, endpoint: "", model: "", apiKey: "", provider: "" },
      jobBrains: { chat: "auto", analysis: "auto", quest: "auto", event: "auto", planning: "auto" },
    },
  };
}

function makeRun(partial: Partial<QuestRun>): QuestRun {
  return {
    id: partial.id ?? "run1",
    questId: partial.questId ?? "q1",
    questName: partial.questName ?? "Walk",
    startedAt: partial.startedAt ?? iso(5),
    endedAt: partial.endedAt ?? iso(4),
    outcome: partial.outcome ?? "completed",
    verification: "self_reported",
    sparksAwarded: 10,
    comboAtCompletion: 1,
    rushRequested: false,
    rushHit: null,
    missReason: partial.missReason ?? null,
    missNote: null,
    energyAtStart: 3,
    moodAtStart: 3,
    momentumAtStart: 30,
  };
}

function makeSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  const profile: Profile = {
    id: "profile",
    displayName: "Player",
    title: "Newcomer",
    avatarSeed: "seed",
    sparks: 100,
    lifetimeSparks: 100,
    rank: 2,
    chapter: "Chapter I",
    currentRun: 3,
    bestRun: 5,
    lastActiveDay: dayKey(),
    combo: 1,
    comboUpdatedAt: null,
    createdAt: iso(200),
  };
  const today: DailyState = {
    id: dayKey(),
    energy: 3,
    mood: 3,
    availableMinutes: 20,
    note: "",
    updatedAt: new Date().toISOString(),
  };
  return {
    profile,
    settings: makeSettings(),
    blueprint: null,
    destinations: [],
    milestones: [],
    boosts: [],
    drains: [],
    quests: [],
    questRuns: [],
    dailyStates: [today],
    events: [],
    attributes: [],
    trophies: [],
    ...overrides,
  };
}

describe("advisor facts", () => {
  it("derives provable metrics from local records only", () => {
    const snapshot = makeSnapshot({
      questRuns: [
        makeRun({ id: "a", outcome: "completed", startedAt: iso(2) }),
        makeRun({ id: "b", outcome: "missed", missReason: "too_tired", startedAt: iso(20) }),
        makeRun({ id: "c", outcome: "missed", missReason: "too_tired", startedAt: iso(30) }),
      ],
    });
    const facts = buildAdvisorFacts(snapshot, 42);
    expect(facts.momentum).toBe(42);
    expect(facts.finishedRuns).toBe(3);
    expect(facts.misses7d).toBe(2);
    expect(facts.topMissReason?.reason).toBe("too_tired");
    expect(facts.completionRate7d).toBeCloseTo(1 / 3);
    expect(facts.stateHash).toMatch(/^st/);
  });

  it("changes the state hash when the situation changes", () => {
    const a = buildAdvisorFacts(makeSnapshot(), 40);
    const b = buildAdvisorFacts(makeSnapshot(), 10);
    expect(a.stateHash).not.toBe(b.stateHash);
  });
});

describe("triggers", () => {
  it("opens a low-momentum situation with its supporting facts", () => {
    const snapshot = makeSnapshot({ questRuns: [makeRun({ id: "a" })] });
    const triggers = detectTriggers(buildAdvisorFacts(snapshot, 8));
    const low = triggers.find((t) => t.code === "momentum_low");
    expect(low).toBeTruthy();
    expect(low!.facts.some((f) => f.includes("8/100"))).toBe(true);
    expect(triggers[0]!.severity).toBeGreaterThanOrEqual(triggers[triggers.length - 1]!.severity);
  });

  it("declares insufficient history instead of inventing advice", () => {
    const triggers = detectTriggers(buildAdvisorFacts(makeSnapshot(), 60));
    expect(triggers.some((t) => t.code === "cold_start")).toBe(true);
  });
});

describe("evidence scoring", () => {
  it("caps confidence at what the evidence supports", () => {
    const weak = scoreEvidence(
      evidenceFromTrigger({ facts: [], observations: ["a"], hypotheses: ["b"] }),
      0,
    );
    expect(weak.strength).toBe("insufficient");
    expect(resolveConfidence(0.99, weak)).toBeLessThanOrEqual(0.3);

    const strong = scoreEvidence(
      evidenceFromTrigger({ facts: ["a", "b", "c", "d"], observations: ["e"], hypotheses: [] }),
      12,
    );
    expect(strong.strength).toBe("strong");
    expect(resolveConfidence(0.99, strong)).toBeLessThanOrEqual(0.9);
  });
});

describe("validation", () => {
  const facts = buildAdvisorFacts(makeSnapshot(), 50);

  it("shrinks a quest that does not fit today's window", () => {
    const result = validateRecommendation({
      action: {
        type: "create_quest",
        quest: {
          name: "Long study block",
          description: "",
          durationMinutes: 90,
          difficulty: "extreme",
          isRecovery: false,
        },
        startImmediately: false,
      },
      facts,
      blueprint: null,
    });
    expect(result.report.ok).toBe(true);
    expect(result.action.type).toBe("create_quest");
    if (result.action.type === "create_quest") {
      expect(result.action.quest.durationMinutes).toBe(20);
      expect(result.action.quest.difficulty).toBe("hard");
    }
  });

  it("blocks a duplicate signature", () => {
    const result = validateRecommendation({
      action: { type: "none" },
      facts,
      blueprint: null,
      signature: "sig-1",
      existingSignatures: ["sig-1"],
    });
    expect(result.report.ok).toBe(false);
    expect(result.report.problems[0]!.code).toBe("duplicate");
  });

  it("blocks anything conflicting with an anti-goal", () => {
    const result = validateRecommendation({
      action: {
        type: "create_quest",
        quest: {
          name: "Late night gaming session",
          description: "",
          durationMinutes: 10,
          difficulty: "easy",
          isRecovery: false,
        },
        startImmediately: false,
      },
      facts,
      blueprint: {
        id: "blueprint",
        rawInput: "",
        direction: "",
        goals: [],
        priorities: [],
        motivators: [],
        preferredDifficulty: "normal",
        preferredQuestStyle: "",
        constraints: [],
        antiGoals: ["gaming"],
        rewardPreferences: [],
        behaviorStrategy: "",
        approved: true,
        generatedBy: "engine",
        createdAt: iso(100),
        approvedAt: iso(100),
      },
    });
    expect(result.report.ok).toBe(false);
    expect(result.report.problems.some((p) => p.code === "anti_goal")).toBe(true);
  });
});

describe("assembly and dedup", () => {
  const snapshot = makeSnapshot({
    questRuns: [makeRun({ id: "a" }), makeRun({ id: "b" }), makeRun({ id: "c", outcome: "missed", missReason: "no_time" })],
  });
  const facts = buildAdvisorFacts(snapshot, 12);
  const triggers = detectTriggers(facts);

  it("produces validated records from local drafts and never exceeds the live limit", () => {
    const drafts = localDrafts(facts, triggers, [
      {
        id: "opt1",
        category: "recovery",
        title: "Two minute reset",
        durationMinutes: 10,
        reason: "Smallest possible restart",
        sparks: 5,
        attribute: "vitality",
        destinationId: null,
        destinationTitle: null,
        difficulty: "easy",
        boostId: null,
        isRecovery: true,
        rush: false,
        source: "engine",
      },
    ]);
    const records = assembleRecommendations({
      drafts,
      facts,
      triggers,
      blueprint: null,
      source: "engine",
      brain: null,
      existingSignatures: [],
    });
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThanOrEqual(3);
    for (const record of records) {
      expect(record.status).toBe("pending");
      expect(record.validation?.ok).toBe(true);
      expect(record.confidence).toBeLessThanOrEqual(0.9);
      expect(record.crossImpacts.length).toBeGreaterThan(0);
    }
  });

  it("skips drafts whose signature is already live", () => {
    const drafts = localDrafts(facts, triggers, []);
    const first = assembleRecommendations({
      drafts,
      facts,
      triggers,
      blueprint: null,
      source: "engine",
      brain: null,
      existingSignatures: [],
    });
    const again = assembleRecommendations({
      drafts,
      facts,
      triggers,
      blueprint: null,
      source: "engine",
      brain: null,
      existingSignatures: first.map((r) => r.signature),
    });
    expect(again).toHaveLength(0);
    expect(signatureFor(drafts[0]!)).toBe(first[0]!.signature);
  });
});

describe("stale revalidation and outcomes", () => {
  const facts = buildAdvisorFacts(makeSnapshot(), 50);
  const base: RecommendationRecord = {
    id: "rec1",
    triggerCode: "window_open",
    triggerLabel: "Window open",
    kind: "quest",
    title: "Walk",
    summary: "",
    action: { type: "none" },
    options: [
      {
        id: "sig#0",
        label: "Just note it",
        summary: "",
        action: { type: "none" },
        tradeOff: "Costs nothing.",
        validation: null,
      },
    ],
    preferredOptionIndex: 0,
    tradeOff: "Costs nothing.",
    evidence: [],
    evidenceScore: { score: 0.5, strength: "moderate", facts: 2, observations: 0, hypotheses: 0, sampleSize: 4 },
    confidence: 0.6,
    crossImpacts: [],
    expectedOutcome: "",
    measureAfterHours: 12,
    status: "pending",
    source: "engine",
    brain: null,
    validation: {
      ok: true,
      problems: [],
      adjustments: [],
      validatedAt: iso(3),
      stateHash: facts.stateHash,
    },
    signature: "sig",
    questId: null,
    momentumAtApproval: null,
    materialSnapshot: materialSnapshotOf(facts),
    chosenOptionId: null,
    usedDriveContext: false,
    updatedAt: new Date().toISOString(),
    createdAt: iso(3),
    decidedAt: null,
    expiresAt: iso(-3),
  };

  it("detects nothing stale while state and window hold", () => {
    expect(checkStale(base, facts)).toBeNull();
  });

  it("flags a changed state and an expired window", () => {
    const moved = buildAdvisorFacts(makeSnapshot(), 5);
    expect(checkStale(base, moved)).toBe("state_changed");
    expect(checkStale({ ...base, expiresAt: iso(1) }, facts)).toBe("expired");
  });

  it("measures outcomes from recorded runs, not from AI claims", () => {
    const applied: RecommendationRecord = {
      ...base,
      status: "applied",
      decidedAt: iso(24),
      questId: "q1",
      momentumAtApproval: 30,
    };
    expect(isDueForMeasurement(applied)).toBe(true);
    const outcome = measureOutcome({
      recommendation: { ...applied, action: { type: "create_quest", quest: { name: "Walk", description: "", durationMinutes: 10, difficulty: "easy", isRecovery: false }, startImmediately: false } },
      facts,
      momentumAtApproval: 30,
      completionsSince: 1,
      missesSince: 0,
      questCompleted: true,
      questMissed: false,
    });
    expect(outcome.result).toBe("followed_worked");
    expect(outcome.metrics.momentumBefore).toBe(30);
    expect(summariseOutcomes([outcome])[0]).toContain("helped");
  });

  it("records honestly when advice was never acted on", () => {
    const outcome = measureOutcome({
      recommendation: base,
      facts,
      momentumAtApproval: 60,
      completionsSince: 0,
      missesSince: 0,
      questCompleted: false,
      questMissed: false,
    });
    expect(outcome.result).toBe("not_followed");
  });
});
describe("phase 4A: options, trade-offs and material change", () => {
  const richSnapshot = makeSnapshot({
    questRuns: [
      makeRun({ id: "a" }),
      makeRun({ id: "b" }),
      makeRun({ id: "c", outcome: "missed", missReason: "no_time" }),
    ],
  });
  const facts = buildAdvisorFacts(richSnapshot, 12);
  const triggers = detectTriggers(facts);

  it("gives every recommendation at least one validated option with a trade-off", () => {
    const drafts = localDrafts(facts, triggers, [
      {
        id: "opt1",
        category: "recovery",
        title: "Two minute reset",
        durationMinutes: 10,
        reason: "Smallest possible restart",
        sparks: 5,
        attribute: "vitality" as const,
        destinationId: null,
        destinationTitle: null,
        difficulty: "easy" as const,
        boostId: null,
        isRecovery: true,
        rush: false,
        source: "engine" as const,
      },
    ]);
    const records = assembleRecommendations({
      drafts,
      facts,
      triggers,
      blueprint: null,
      source: "engine",
      brain: null,
      existingSignatures: [],
    });
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.options.length).toBeGreaterThanOrEqual(1);
      expect(record.options.length).toBeLessThanOrEqual(3);
      expect(record.tradeOff.length).toBeGreaterThan(0);
      for (const option of record.options) {
        expect(option.tradeOff.length).toBeGreaterThan(0);
        expect(option.validation?.ok).toBe(true);
      }
      expect(record.options[record.preferredOptionIndex]).toBeDefined();
      expect(record.action).toEqual(record.options[record.preferredOptionIndex]!.action);
    }
  });

  it("keeps ids deterministic per option so two devices converge", () => {
    const build = () =>
      assembleRecommendations({
        drafts: localDrafts(facts, triggers, [
      {
        id: "opt1",
        category: "recovery",
        title: "Two minute reset",
        durationMinutes: 10,
        reason: "Smallest possible restart",
        sparks: 5,
        attribute: "vitality" as const,
        destinationId: null,
        destinationTitle: null,
        difficulty: "easy" as const,
        boostId: null,
        isRecovery: true,
        rush: false,
        source: "engine" as const,
      },
    ]),
        facts,
        triggers,
        blueprint: null,
        source: "engine",
        brain: null,
        existingSignatures: [],
      });
    const a = build();
    const b = build();
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(a[0]!.options.map((o) => o.id)).toEqual(b[0]!.options.map((o) => o.id));
  });

  it("detects material change deterministically and ignores noise", () => {
    const before = materialSnapshotOf(buildAdvisorFacts(makeSnapshot(), 50));
    const same = buildAdvisorFacts(makeSnapshot(), 52);
    expect(isMaterialChange(detectMaterialChanges(before, same))).toBe(false);

    const moved = buildAdvisorFacts(
      makeSnapshot({
        questRuns: [
          makeRun({ id: "r1", outcome: "completed", startedAt: iso(1) }),
          makeRun({ id: "r2", outcome: "completed", startedAt: iso(2) }),
        ],
      }),
      50,
    );
    const changes = detectMaterialChanges(before, moved);
    expect(isMaterialChange(changes)).toBe(true);
    expect(changes.some((c) => c.code === "completed_since")).toBe(true);
  });

  it("suppresses signatures the player recently declined", () => {
    const stub = (id: string, signature: string, decidedAt: string): RecommendationRecord =>
      ({ id, signature, decidedAt, status: "rejected", createdAt: decidedAt }) as RecommendationRecord;
    const declined = stub("rec-declined", "sig-declined", iso(24));
    const old = stub("rec-old", "sig-old", iso(24 * 40));
    const unused: Record<string, string> = {
      id: "rec-declined",
      status: "rejected",
    };
    void unused;
    const suppressed = suppressedSignatures([declined, old]);
    expect(suppressed).toContain("sig-declined");
    expect(suppressed).not.toContain("sig-old");
  });
});
