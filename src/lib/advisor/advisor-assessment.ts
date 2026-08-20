import type { AdvisorFacts } from "./advisor-facts";
import type { RecommendationRecord } from "./advisor-types";
import { detectMaterialChanges, isMaterialChange, type MaterialChange } from "./advisor-feedback";

/**
 * PHASE 4A STABILISATION — cloud assessment gate.
 *
 * Deterministic material-change detection and revalidation keep running on
 * their own: they are local arithmetic over the player's own records. A *cloud*
 * AI assessment is different — it sends context off the device — so it never
 * runs from a passive state change. It requires an explicit user action. Local
 * brains (phone / Ollama) stay available automatically because nothing leaves
 * the device.
 */

export type AssessmentBrainId = string | null;

export interface AssessmentPlan {
  /** True only when an AI assessment call is allowed for this pass. */
  useAi: boolean;
  /** True when that call would reach a cloud brain. */
  cloud: boolean;
  /** Player-facing explanation of what was (not) used. */
  note: string;
}

export function isCloudBrain(brainId: AssessmentBrainId): boolean {
  return brainId === "cloud";
}

/** The single rule: cloud assessment requires an explicit user action. */
export function cloudAssessmentAllowed(input: {
  requestedByUser: boolean;
  brainId: AssessmentBrainId;
}): boolean {
  return isCloudBrain(input.brainId) && input.requestedByUser;
}

export function assessmentPlan(input: {
  requestedByUser: boolean;
  brainId: AssessmentBrainId;
}): AssessmentPlan {
  if (isCloudBrain(input.brainId)) {
    if (input.requestedByUser) {
      return { useAi: true, cloud: true, note: "Cloud AI re-checked this at your request." };
    }
    return {
      useAi: false,
      cloud: false,
      note: "Checked on this device only — no cloud AI assessment was performed.",
    };
  }
  if (input.brainId) {
    return { useAi: true, cloud: false, note: "Checked with your local brain, on this device." };
  }
  return {
    useAi: false,
    cloud: false,
    note: "Checked on this device only — no cloud AI assessment was performed.",
  };
}

export interface AssessmentUpdate {
  record: RecommendationRecord;
  changes: MaterialChange[];
}

export interface AssessmentRun {
  updates: AssessmentUpdate[];
  /** How many AI calls were actually made — 0 on the passive path with a cloud brain. */
  aiCalls: number;
  cloudUsed: boolean;
  note: string;
}

/**
 * Deterministic first: only recommendations whose situation provably moved are
 * candidates. An allowed AI layer may then *veto* a candidate; it can never add
 * one, and it is skipped entirely when the gate is closed.
 */
export async function assessMaterialChanges(input: {
  records: RecommendationRecord[];
  facts: AdvisorFacts;
  brainId: AssessmentBrainId;
  requestedByUser: boolean;
  assess?: (
    record: RecommendationRecord,
    changes: MaterialChange[],
  ) => Promise<{ still_valid: boolean } | null>;
}): Promise<AssessmentRun> {
  const plan = assessmentPlan({
    requestedByUser: input.requestedByUser,
    brainId: input.brainId,
  });
  const updates: AssessmentUpdate[] = [];
  let aiCalls = 0;

  for (const record of input.records) {
    const changes = detectMaterialChanges(record.materialSnapshot, input.facts);
    if (!isMaterialChange(changes)) continue;
    if (plan.useAi && input.assess) {
      aiCalls += 1;
      const verdict = await input.assess(record, changes);
      // The brain agrees the advice survives the change: leave it alone.
      if (verdict && verdict.still_valid) continue;
    }
    updates.push({ record, changes });
  }

  return { updates, aiCalls, cloudUsed: plan.cloud && aiCalls > 0, note: plan.note };
}
