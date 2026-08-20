import type { AdvisorFacts } from "./advisor-facts";
import type {
  OutcomeResult,
  RecommendationOutcomeRecord,
  RecommendationRecord,
} from "./advisor-types";

/**
 * Outcome measurement. Deterministic: an applied recommendation is measured
 * against real completions/misses recorded after it was approved, never against
 * the AI's own claim. Results feed future recommendations as decision memory.
 */

export interface MeasureInput {
  recommendation: RecommendationRecord;
  facts: AdvisorFacts;
  momentumAtApproval: number;
  /** Runs recorded after the recommendation was approved. */
  completionsSince: number;
  missesSince: number;
  /** True when the quest this recommendation created was completed. */
  questCompleted: boolean;
  questMissed: boolean;
  now?: number;
}

export function isDueForMeasurement(
  record: RecommendationRecord,
  now: number = Date.now(),
): boolean {
  if (record.status !== "applied" || !record.decidedAt) return false;
  return now - Date.parse(record.decidedAt) >= record.measureAfterHours * 3_600_000;
}

export function measureOutcome(input: MeasureInput): RecommendationOutcomeRecord {
  const now = input.now ?? Date.now();
  const momentumAfter = input.facts.momentum;
  let result: OutcomeResult;

  if (input.recommendation.action.type === "create_quest") {
    if (input.questCompleted) {
      result = momentumAfter >= input.momentumAtApproval ? "followed_worked" : "followed_no_change";
    } else if (input.questMissed) {
      result = "followed_no_change";
    } else {
      result = "not_followed";
    }
  } else if (input.completionsSince > 0) {
    result = momentumAfter >= input.momentumAtApproval ? "followed_worked" : "followed_no_change";
  } else {
    result = "not_followed";
  }

  return {
    id: `out_${input.recommendation.id}`,
    recommendationId: input.recommendation.id,
    measuredAt: new Date(now).toISOString(),
    result,
    note: describe(result, input),
    metrics: {
      momentumBefore: Math.round(input.momentumAtApproval),
      momentumAfter: Math.round(momentumAfter),
      completionsAfter: input.completionsSince,
      missesAfter: input.missesSince,
    },
    source: "engine",
  };
}

function describe(result: OutcomeResult, input: MeasureInput): string {
  const delta = Math.round(input.facts.momentum - input.momentumAtApproval);
  const move = delta === 0 ? "unchanged" : delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`;
  switch (result) {
    case "followed_worked":
      return `Followed through; momentum ${move}.`;
    case "followed_no_change":
      return `Followed through, but momentum was ${move}.`;
    case "not_followed":
      return `No matching action was recorded. Momentum ${move}.`;
    default:
      return "Not measured yet.";
  }
}

/** Short, honest summary of past advice — used as decision memory in prompts. */
export function summariseOutcomes(outcomes: RecommendationOutcomeRecord[]): string[] {
  const counts = new Map<OutcomeResult, number>();
  for (const outcome of outcomes) {
    counts.set(outcome.result, (counts.get(outcome.result) ?? 0) + 1);
  }
  const lines: string[] = [];
  const worked = counts.get("followed_worked") ?? 0;
  const noChange = counts.get("followed_no_change") ?? 0;
  const skipped = counts.get("not_followed") ?? 0;
  if (worked) lines.push(`${worked} past recommendation(s) were followed and helped.`);
  if (noChange) lines.push(`${noChange} were followed without a measurable change.`);
  if (skipped) lines.push(`${skipped} were approved but never acted on.`);
  return lines;
}