import type { AdvisorFacts } from "./advisor-facts";

/**
 * Graded staleness (Phase 5, item 1).
 *
 * Phase 4A/4C treated every state change as equally disqualifying: any change
 * to the state fingerprint forced a re-approval. That is safe but noisy — a
 * single extra completion today should not invalidate advice.
 *
 * This module classifies a change deterministically. The AI is never consulted
 * here and can never downgrade a change to "safe".
 *
 * - none      identical state
 * - minor     recommendation stays valid, approval still counts
 * - material  must be revalidated; approval is renewed
 * - critical  execution is blocked and the situation is recomputed
 */

export type ChangeGrade = "none" | "minor" | "material" | "critical";

/** The exact fields the grading rules read. Stored with a validation report. */
export interface StateSignature {
  momentum: number;
  energy: number | null;
  mood: number | null;
  availableMinutes: number | null;
  hasActiveRun: boolean;
  completionsToday: number;
  completions7d: number;
  misses7d: number;
  currentRun: number;
}

export function stateSignature(facts: AdvisorFacts): StateSignature {
  return {
    momentum: Math.round(facts.momentum),
    energy: facts.energy,
    mood: facts.mood,
    availableMinutes: facts.availableMinutes,
    hasActiveRun: facts.hasActiveRun,
    completionsToday: facts.completionsToday,
    completions7d: facts.completions7d,
    misses7d: facts.misses7d,
    currentRun: facts.currentRun,
  };
}

const GRADE_RANK: Record<ChangeGrade, number> = {
  none: 0,
  minor: 1,
  material: 2,
  critical: 3,
};

export function worstGrade(a: ChangeGrade, b: ChangeGrade): ChangeGrade {
  return GRADE_RANK[a] >= GRADE_RANK[b] ? a : b;
}

function diff(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return Math.abs(a - b);
}

/**
 * Deterministic classification. Rules, in order of severity:
 *
 * critical  — a run started or finished, or the streak day rolled over, or the
 *             available time collapsed below a workable window. Anything
 *             validated against the old state could now do the wrong thing.
 * material  — energy/mood moved by 2+ points, momentum moved by 15+, available
 *             time changed by a quarter or more, or a new miss was recorded.
 * minor     — everything else that differs (one extra completion, ±1 mood,
 *             small momentum drift).
 */
export function gradeStateChange(
  before: StateSignature | null | undefined,
  after: StateSignature,
): ChangeGrade {
  if (!before) return "material";

  let grade: ChangeGrade = "none";

  if (before.hasActiveRun !== after.hasActiveRun) grade = worstGrade(grade, "critical");
  if (before.currentRun !== after.currentRun) grade = worstGrade(grade, "critical");
  if (
    before.availableMinutes != null &&
    after.availableMinutes != null &&
    before.availableMinutes >= 30 &&
    after.availableMinutes < 15
  ) {
    grade = worstGrade(grade, "critical");
  }

  const energyDelta = diff(before.energy, after.energy);
  const moodDelta = diff(before.mood, after.mood);
  const minutesDelta = diff(before.availableMinutes, after.availableMinutes);

  if (energyDelta != null && energyDelta >= 2) grade = worstGrade(grade, "material");
  if (moodDelta != null && moodDelta >= 2) grade = worstGrade(grade, "material");
  if (Math.abs(before.momentum - after.momentum) >= 15) grade = worstGrade(grade, "material");
  if (
    minutesDelta != null &&
    before.availableMinutes != null &&
    before.availableMinutes > 0 &&
    minutesDelta / before.availableMinutes >= 0.25
  ) {
    grade = worstGrade(grade, "material");
  }
  if (after.misses7d > before.misses7d) grade = worstGrade(grade, "material");
  if ((before.energy == null) !== (after.energy == null)) grade = worstGrade(grade, "material");
  if ((before.mood == null) !== (after.mood == null)) grade = worstGrade(grade, "material");
  if ((before.availableMinutes == null) !== (after.availableMinutes == null)) {
    grade = worstGrade(grade, "material");
  }

  if (grade !== "none") return grade;

  const differs =
    before.momentum !== after.momentum ||
    before.energy !== after.energy ||
    before.mood !== after.mood ||
    before.availableMinutes !== after.availableMinutes ||
    before.completionsToday !== after.completionsToday ||
    before.completions7d !== after.completions7d ||
    before.misses7d !== after.misses7d;

  return differs ? "minor" : "none";
}

/** Plain-language explanation for the UI. No internal vocabulary. */
export function describeGrade(grade: ChangeGrade): string {
  switch (grade) {
    case "critical":
      return "Your situation changed enough that this needs to be worked out again.";
    case "material":
      return "Something meaningful changed, so this was checked again before applying.";
    case "minor":
      return "Small changes since this was suggested — it still holds.";
    default:
      return "Nothing has changed since this was suggested.";
  }
}
