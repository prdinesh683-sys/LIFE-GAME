import type { GoalClarificationResponse } from "./schemas";

/**
 * InterviewEngine — Adaptive Goal Interview loop.
 *
 * Principles:
 * - Asks ONE high-value question at a time.
 * - Stops interviewing as soon as enough information exists to build a playable v1 game.
 * - Tolerates uncertainty and starts without demanding perfection.
 */

export interface GoalInterviewState {
  rawGoal: string;
  turns: { question: string; answer: string }[];
  clarifiedData: Partial<GoalClarificationResponse>;
  isReadyForCampaign: boolean;
}

export function evaluateInterviewReadiness(
  clarified: Partial<GoalClarificationResponse>,
  turnCount: number,
): { ready: boolean; nextQuestion: string | null } {
  // If the user already provided a goal and at least a basic outcome or timeframe, it's ready
  if (clarified.goal && (clarified.desired_outcome || clarified.deadline || turnCount >= 2)) {
    return { ready: true, nextQuestion: null };
  }

  if (!clarified.desired_outcome) {
    return {
      ready: false,
      nextQuestion: "What does 'finished' look like for this goal?",
    };
  }

  if (!clarified.deadline) {
    return {
      ready: false,
      nextQuestion: "Do you have a target timeframe or deadline in mind (e.g. 6 months, 4 weeks)?",
    };
  }

  return { ready: true, nextQuestion: null };
}
