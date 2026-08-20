import { describe, expect, it } from "vitest";

import { gradeStateChange, type StateSignature } from "../state-grade";
import {
  grantTrust,
  isTrusted,
  revokeTrust,
  shouldOfferTrust,
  approvalsByActionType,
  streamlineDecision,
  TRUST_THRESHOLD,
} from "../action-trust";
import { rightSize } from "../../agent/right-size";
import { buildWeeklyReview } from "../../game/weekly-review";
import { evidenceState, hasHistoricalEvidence, personalizedPhrase, starterRecommendation } from "../../game/cold-start";
import { recommendationStatusLabel, friendlyError, conceptLabel } from "../../ui/labels";

const base: StateSignature = {
  momentum: 50,
  energy: 3,
  mood: 3,
  availableMinutes: 40,
  hasActiveRun: false,
  completionsToday: 1,
  completions7d: 5,
  misses7d: 1,
  currentRun: 3,
};

describe("graded staleness", () => {
  it("is deterministic and returns none for an identical signature", () => {
    expect(gradeStateChange(base, { ...base })).toBe("none");
    expect(gradeStateChange(base, { ...base })).toBe("none");
  });

  it("treats one extra completion as minor", () => {
    expect(gradeStateChange(base, { ...base, completionsToday: 2, completions7d: 6 })).toBe("minor");
  });

  it("treats a two-point energy drop as material", () => {
    expect(gradeStateChange(base, { ...base, energy: 1 })).toBe("material");
  });

  it("treats a new miss as material", () => {
    expect(gradeStateChange(base, { ...base, misses7d: 2 })).toBe("material");
  });

  it("treats a run starting or the streak rolling over as critical", () => {
    expect(gradeStateChange(base, { ...base, hasActiveRun: true })).toBe("critical");
    expect(gradeStateChange(base, { ...base, currentRun: 4 })).toBe("critical");
  });

  it("fails closed when no prior signature was recorded", () => {
    expect(gradeStateChange(undefined, base)).toBe("material");
  });
});

describe("remembered trust", () => {
  it("never trusts a HIGH_IMPACT action", () => {
    expect(
      shouldOfferTrust({
        actionType: "create_quest",
        permission: "HIGH_IMPACT",
        approvalsOfType: 99,
        grants: [],
      }),
    ).toBe(false);
    expect(isTrusted([{ actionType: "create_quest", grantedAt: "x" }], "create_quest", "HIGH_IMPACT")).toBe(
      false,
    );
  });

  it("offers trust only after the threshold and only once", () => {
    expect(
      shouldOfferTrust({
        actionType: "create_quest",
        permission: "LOW_RISK_WRITE",
        approvalsOfType: TRUST_THRESHOLD - 1,
        grants: [],
      }),
    ).toBe(false);
    const grants = grantTrust([], "create_quest", "LOW_RISK_WRITE");
    expect(isTrusted(grants, "create_quest", "LOW_RISK_WRITE")).toBe(true);
    expect(
      shouldOfferTrust({
        actionType: "create_quest",
        permission: "LOW_RISK_WRITE",
        approvalsOfType: TRUST_THRESHOLD,
        grants,
      }),
    ).toBe(false);
    expect(isTrusted(revokeTrust(grants, "create_quest"), "create_quest", "LOW_RISK_WRITE")).toBe(false);
  });

  it("refuses action types outside the eligible list", () => {
    expect(grantTrust([], "delete_everything", "LOW_RISK_WRITE")).toEqual([]);
  });
});

describe("agent right-sizing", () => {
  const task = (id: string, deps: string[] = [], permissionClass = "LOW_RISK_WRITE") =>
    ({ id, dependencyIds: deps, permissionClass }) as never;

  it("calls one or two independent actions a direct action", () => {
    expect(rightSize([task("a")]).shape).toBe("direct_action");
    expect(rightSize([task("a"), task("b")]).shape).toBe("direct_action");
  });

  it("only becomes a plan with three dependent write actions", () => {
    expect(rightSize([task("a"), task("b"), task("c")]).shape).toBe("direct_action");
    expect(rightSize([task("a"), task("b", ["a"]), task("c", ["b"])]).shape).toBe("plan");
  });
});

describe("weekly review", () => {
  const run = (over: Record<string, unknown>) =>
    ({
      id: Math.random().toString(),
      questId: "q",
      questName: "Quest",
      startedAt: new Date(Date.now() - 86_400_000).toISOString(),
      endedAt: new Date(Date.now() - 86_400_000 + 600_000).toISOString(),
      outcome: "completed",
      sparksAwarded: 10,
      ...over,
    }) as never;

  it("reports no evidence when the week is empty", () => {
    expect(buildWeeklyReview({ runs: [], accepted: 0, rejected: 0 }).hasEvidence).toBe(false);
  });

  it("counts finished and missed work in the window", () => {
    const review = buildWeeklyReview({
      runs: [run({}), run({}), run({ outcome: "missed", missReason: "no_time" })],
      accepted: 2,
      rejected: 1,
    });
    expect(review.completed).toBe(2);
    expect(review.missed).toBe(1);
    expect(review.adjustment.length).toBeGreaterThan(0);
  });
});

describe("cold start", () => {
  it("never claims a habit before enough finished runs", () => {
    const state = evidenceState({ runs: [], blueprint: null, destinations: [] });
    expect(hasHistoricalEvidence(state)).toBe(false);
    expect(personalizedPhrase(state, "finish in the morning", "mornings could work")).not.toContain(
      "You usually",
    );
  });

  it("still produces a small day-one action", () => {
    const starter = starterRecommendation({ today: null, destinations: [], blueprint: null });
    expect(starter.durationMinutes).toBeGreaterThan(0);
    expect(starter.durationMinutes).toBeLessThanOrEqual(20);
  });
});

describe("human terminology", () => {
  it("never shows internal lifecycle words", () => {
    expect(recommendationStatusLabel("needs_reapproval")).toBe("Needs an update");
    expect(conceptLabel("provenance")).toBe("Why I remember this");
  });

  it("hides technical error detail behind a friendly fallback", () => {
    expect(friendlyError(new TypeError("undefined is not an object"))).toBe(
      "That didn't work. Nothing was changed.",
    );
  });
});

describe("remembered trust at runtime", () => {
  const grants = grantTrust([], "create_quest", "LOW_RISK_WRITE");

  it("counts only applied approvals per action type", () => {
    const counts = approvalsByActionType([
      { status: "applied", action: { type: "create_quest" } },
      { status: "applied", action: { type: "create_quest" } },
      { status: "rejected", action: { type: "create_quest" } },
      { status: "applied", action: { type: "add_memory" } },
    ]);
    expect(counts["create_quest"]).toBe(2);
    expect(counts["add_memory"]).toBe(1);
  });

  it("streamlines a trusted low-risk action but never skips validation", () => {
    const decision = streamlineDecision({
      actionType: "create_quest",
      permission: "LOW_RISK_WRITE",
      grants,
      stale: false,
    });
    expect(decision.streamlined).toBe(true);
    expect(decision.requiresValidation).toBe(true);
    expect(decision.requiresFreshState).toBe(true);
  });

  it("asks again when the state changed and always asks for high impact", () => {
    expect(
      streamlineDecision({ actionType: "create_quest", permission: "LOW_RISK_WRITE", grants, stale: true })
        .streamlined,
    ).toBe(false);
    expect(
      streamlineDecision({ actionType: "create_quest", permission: "HIGH_IMPACT", grants, stale: false })
        .streamlined,
    ).toBe(false);
  });

  it("stops streamlining after revocation", () => {
    const revoked = revokeTrust(grants, "create_quest");
    expect(
      streamlineDecision({ actionType: "create_quest", permission: "LOW_RISK_WRITE", grants: revoked, stale: false })
        .streamlined,
    ).toBe(false);
  });
});

describe("right-sizing two chained actions", () => {
  const task = (id: string, deps: string[] = [], permissionClass = "LOW_RISK_WRITE") =>
    ({ id, dependencyIds: deps, permissionClass }) as never;

  it("plans two chained actions only when one takes over your time", () => {
    expect(rightSize([task("a"), task("b", ["a"])]).shape).toBe("direct_action");
    expect(rightSize([task("a"), task("b", ["a"], "HIGH_IMPACT")]).shape).toBe("plan");
  });
});
