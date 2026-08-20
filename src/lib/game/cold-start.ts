import type { DailyState, Destination, PersonalBlueprint, QuestRun } from "./types";

/**
 * Cold start and evidence-gated language (Phase 5, items 7 and 27–28).
 *
 * A brand new player has no history. The system must still be useful on day
 * one — but it must never claim a habit it has not observed. "You usually…" is
 * only allowed once real runs exist; otherwise the phrasing is explicitly
 * "Based on what you told me…".
 */

/** Minimum finished runs before historical phrasing is honest. */
export const EVIDENCE_THRESHOLD = 3;

export interface EvidenceState {
  finishedRuns: number;
  hasOnboardingAnswers: boolean;
}

export function evidenceState(input: {
  runs: QuestRun[];
  blueprint: PersonalBlueprint | null;
  destinations: Destination[];
}): EvidenceState {
  return {
    finishedRuns: input.runs.filter((r) => r.outcome !== "in_progress").length,
    hasOnboardingAnswers: Boolean(input.blueprint) || input.destinations.length > 0,
  };
}

export function hasHistoricalEvidence(state: EvidenceState): boolean {
  return state.finishedRuns >= EVIDENCE_THRESHOLD;
}

/**
 * Wraps a personalization claim in phrasing the evidence actually supports.
 * `historical` must describe an observed pattern; `stated` describes something
 * the player told the app during onboarding.
 */
export function personalizedPhrase(
  state: EvidenceState,
  historical: string,
  stated: string,
): string {
  if (hasHistoricalEvidence(state)) return `You usually ${historical}`;
  if (state.hasOnboardingAnswers) return `Based on what you told me, ${stated}`;
  return stated.charAt(0).toUpperCase() + stated.slice(1);
}

export interface StarterRecommendation {
  title: string;
  durationMinutes: number;
  why: string;
}

/**
 * Deterministic day-one recommendation from current information only:
 * onboarding answers, stated goals and today's declared time/energy. No
 * history is invented, and no AI call is made.
 */
export function starterRecommendation(input: {
  today: DailyState | null;
  destinations: Destination[];
  blueprint: PersonalBlueprint | null;
}): StarterRecommendation {
  const available = input.today?.availableMinutes ?? 20;
  const energy = input.today?.energy ?? 3;
  const goal = input.destinations.find((d) => d.status === "active") ?? null;
  const minutes = Math.max(5, Math.min(available, energy <= 2 ? 10 : 20));

  if (goal) {
    return {
      title: `${minutes}-minute first step on "${goal.title}"`,
      durationMinutes: minutes,
      why: `Based on what you told me, "${goal.title}" matters to you. The first step only has to be small enough to actually happen.`,
    };
  }

  if (input.blueprint) {
    return {
      title: `${minutes}-minute starter quest`,
      durationMinutes: minutes,
      why: "Based on what you told me, this fits the time you said you have today.",
    };
  }

  return {
    title: "5-minute reset",
    durationMinutes: 5,
    why: "Start with something small and real. Once you've finished a few, I'll start recognising your patterns.",
  };
}
