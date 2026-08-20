import { describe, expect, it } from "vitest";

import { assessmentPlan, assessMaterialChanges, cloudAssessmentAllowed } from "../advisor-assessment";
import type { AdvisorFacts } from "../advisor-facts";
import type { RecommendationRecord } from "../advisor-types";

/**
 * The gate: nothing leaves the device unless the player asked for it. Local
 * checking keeps working either way.
 */
const facts = {
  momentum: 40,
  energy: 1,
  mood: "drained",
  availableMinutes: 5,
  hasActiveRun: false,
  completionsToday: 0,
  misses7d: 4,
  currentRun: 0,
  activeDestinations: [],
  runAtRisk: true,
} as unknown as AdvisorFacts;

function record(): RecommendationRecord {
  return {
    materialSnapshot: {
      momentum: 90,
      energy: 5,
      mood: "good",
      availableMinutes: 60,
      hasActiveRun: false,
      completionsToday: 3,
      misses7d: 0,
      currentRun: 6,
      activeDestinations: 2,
      runAtRisk: false,
    },
  } as unknown as RecommendationRecord;
}

describe("advisor cloud assessment gate", () => {
  it("blocks cloud assessment on a passive state change", () => {
    expect(cloudAssessmentAllowed({ requestedByUser: false, brainId: "cloud" })).toBe(false);
    const plan = assessmentPlan({ requestedByUser: false, brainId: "cloud" });
    expect(plan.useAi).toBe(false);
    expect(plan.note).toContain("no cloud AI");
  });

  it("allows cloud assessment only when the player asks", () => {
    expect(cloudAssessmentAllowed({ requestedByUser: true, brainId: "cloud" })).toBe(true);
    expect(assessmentPlan({ requestedByUser: true, brainId: "cloud" })).toMatchObject({
      useAi: true,
      cloud: true,
    });
  });

  it("keeps local brains available without asking — nothing leaves the device", () => {
    expect(assessmentPlan({ requestedByUser: false, brainId: "ollama" })).toMatchObject({
      useAi: true,
      cloud: false,
    });
  });

  it("makes zero AI calls on the passive path yet still detects the change", async () => {
    let calls = 0;
    const run = await assessMaterialChanges({
      records: [record()],
      facts,
      brainId: "cloud",
      requestedByUser: false,
      assess: async () => {
        calls += 1;
        return { still_valid: true };
      },
    });
    expect(calls).toBe(0);
    expect(run.aiCalls).toBe(0);
    expect(run.cloudUsed).toBe(false);
    // Deterministic detection is unaffected by the gate.
    expect(run.updates).toHaveLength(1);
  });

  it("lets an explicitly requested cloud check veto a stale flag", async () => {
    const run = await assessMaterialChanges({
      records: [record()],
      facts,
      brainId: "cloud",
      requestedByUser: true,
      assess: async () => ({ still_valid: true }),
    });
    expect(run.aiCalls).toBe(1);
    expect(run.cloudUsed).toBe(true);
    expect(run.updates).toHaveLength(0);
  });
});
