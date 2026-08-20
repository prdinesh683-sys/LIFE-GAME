/**
 * PHASE 4C — bounded retry behaviour.
 *
 * Failures are never retried indefinitely and never silently. After the third
 * attempt the runtime stops, explains and proposes recovery or a replan.
 */

export const MAX_ATTEMPTS = 3;

export type FailureDecision = "retry" | "escalate";

export interface FailureVerdict {
  decision: FailureDecision;
  attempts: number;
  message: string;
}

export function decideAfterFailure(attempts: number, error: string): FailureVerdict {
  if (attempts < MAX_ATTEMPTS) {
    return {
      decision: "retry",
      attempts,
      message: `Attempt ${attempts} of ${MAX_ATTEMPTS} failed: ${error}`,
    };
  }
  return {
    decision: "escalate",
    attempts,
    message: `Stopped after ${MAX_ATTEMPTS} attempts: ${error}. This needs a decision from you — retry differently, replan, or drop the task.`,
  };
}

export function recoveryProposal(taskTitle: string, error: string): string {
  return `"${taskTitle}" kept failing (${error}). Options: replan around it, skip it, or change the task so it fits your current state.`;
}
