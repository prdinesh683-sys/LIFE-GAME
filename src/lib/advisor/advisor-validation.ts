import { validateDraft } from "../game/quest-engine";
import type { Difficulty, PersonalBlueprint } from "../game/types";
import type { AdvisorFacts } from "./advisor-facts";
import type {
  RecommendationAction,
  RecommendationRecord,
  ValidationProblem,
  ValidationReport,
} from "./advisor-types";
import { gradeStateChange, stateSignature, type ChangeGrade } from "./state-grade";

/**
 * Deterministic validation. Runs twice: once before a recommendation is ever
 * shown, and again at approval time (revalidation) so a stale proposal can
 * never be executed against changed state.
 */

const DIFFICULTY_ORDER: Difficulty[] = ["trivial", "easy", "normal", "hard", "extreme"];

function maxDifficultyForEnergy(energy: number | null): Difficulty {
  if (energy == null) return "normal";
  if (energy <= 1) return "easy";
  if (energy === 2) return "normal";
  if (energy <= 4) return "hard";
  return "extreme";
}

export interface ValidationInput {
  action: RecommendationAction;
  facts: AdvisorFacts;
  blueprint: PersonalBlueprint | null;
  /** Signatures of other live recommendations — duplicates are rejected. */
  existingSignatures?: string[];
  signature?: string;
}

export interface ValidationOutput {
  report: ValidationReport;
  action: RecommendationAction;
}

function antiGoalHit(blueprint: PersonalBlueprint | null, text: string): string | null {
  return (
    (blueprint?.antiGoals ?? []).find(
      (goal) => goal.trim().length > 3 && text.toLowerCase().includes(goal.trim().toLowerCase()),
    ) ?? null
  );
}

export function validateRecommendation(input: ValidationInput): ValidationOutput {
  const problems: ValidationProblem[] = [];
  const adjustments: string[] = [];
  let action = input.action;
  const { facts, blueprint } = input;

  if (input.signature && input.existingSignatures?.includes(input.signature)) {
    problems.push({
      code: "duplicate",
      message: "An identical recommendation is already open.",
      severity: "block",
    });
  }

  if (action.type === "create_quest") {
    const quest = { ...action.quest };

    if (!quest.name.trim()) {
      problems.push({ code: "no_name", message: "The proposed quest has no name.", severity: "block" });
    }

    const available = facts.availableMinutes;
    if (available != null && available > 0 && quest.durationMinutes > available) {
      adjustments.push(
        `Shortened from ${quest.durationMinutes} to ${available} minutes to fit today's available time.`,
      );
      quest.durationMinutes = available;
      problems.push({
        code: "duration_over_window",
        message: "Proposed duration exceeded today's available minutes.",
        severity: "adjust",
      });
    }
    if (quest.durationMinutes < 5) {
      adjustments.push("Raised to the 5 minute minimum.");
      quest.durationMinutes = 5;
    }
    quest.durationMinutes = Math.round(quest.durationMinutes);

    const cap = maxDifficultyForEnergy(facts.energy);
    if (DIFFICULTY_ORDER.indexOf(quest.difficulty) > DIFFICULTY_ORDER.indexOf(cap)) {
      adjustments.push(`Difficulty lowered to ${cap} for today's energy.`);
      quest.difficulty = cap;
      problems.push({
        code: "difficulty_over_energy",
        message: "Proposed difficulty was above what today's energy supports.",
        severity: "adjust",
      });
    }

    if (facts.momentum < 20 && !quest.isRecovery && quest.durationMinutes > 20) {
      adjustments.push("Capped at 20 minutes while momentum is low.");
      quest.durationMinutes = 20;
    }

    if (action.startImmediately && facts.hasActiveRun) {
      problems.push({
        code: "active_run",
        message: "A quest is already running, so this one cannot start immediately.",
        severity: "adjust",
      });
      adjustments.push("Will be queued instead of started immediately.");
      action = { ...action, startImmediately: false, quest };
    }

    const antiGoal = antiGoalHit(blueprint, quest.name);
    if (antiGoal) {
      problems.push({
        code: "anti_goal",
        message: `This conflicts with something you marked as an anti-goal ("${antiGoal}").`,
        severity: "block",
      });
    }

    const engineCheck = validateDraft({
      name: quest.name,
      durationMinutes: quest.durationMinutes,
      difficulty: quest.difficulty,
    });
    if (!engineCheck.ok) {
      for (const message of engineCheck.errors) {
        problems.push({ code: "engine_rejected", message, severity: "block" });
      }
    }

    action = action.type === "create_quest" ? { ...action, quest } : action;
  }

  if (action.type === "create_boost") {
    const boost = { ...action.boost };
    if (!boost.name.trim()) {
      problems.push({ code: "no_name", message: "The proposed routine has no name.", severity: "block" });
    }
    if (!Number.isFinite(boost.durationMinutes) || boost.durationMinutes < 5) {
      adjustments.push("Routine length raised to the 5 minute minimum.");
      boost.durationMinutes = 5;
    }
    const window = facts.availableMinutes;
    if (window != null && window > 0 && boost.durationMinutes > window) {
      adjustments.push(`Routine shortened to ${window} minutes to fit a normal day.`);
      boost.durationMinutes = window;
      problems.push({
        code: "duration_over_window",
        message: "Proposed routine was longer than a typical available window.",
        severity: "adjust",
      });
    }
    boost.durationMinutes = Math.round(boost.durationMinutes);
    const cap = maxDifficultyForEnergy(facts.energy);
    if (DIFFICULTY_ORDER.indexOf(boost.difficulty) > DIFFICULTY_ORDER.indexOf(cap)) {
      adjustments.push(`Routine difficulty lowered to ${cap} for your usual energy.`);
      boost.difficulty = cap;
    }
    const clash = antiGoalHit(blueprint, boost.name);
    if (clash) {
      problems.push({
        code: "anti_goal",
        message: `This routine conflicts with an anti-goal ("${clash}").`,
        severity: "block",
      });
    }
    action = { ...action, boost };
  }

  if (action.type === "create_destination") {
    const destination = { ...action.destination };
    if (!destination.title.trim()) {
      problems.push({ code: "no_name", message: "The proposed goal has no title.", severity: "block" });
    }
    const activeCount = facts.activeDestinations.length;
    if (activeCount >= 5) {
      problems.push({
        code: "too_many_goals",
        message: `You already have ${activeCount} active destinations — adding another splits your focus.`,
        severity: "block",
      });
    }
    if (!Number.isFinite(destination.priority)) destination.priority = activeCount + 1;
    destination.priority = Math.max(1, Math.min(9, Math.round(destination.priority)));
    const clash = antiGoalHit(blueprint, destination.title);
    if (clash) {
      problems.push({
        code: "anti_goal",
        message: `This goal conflicts with an anti-goal ("${clash}").`,
        severity: "block",
      });
    }
    action = { ...action, destination };
  }

  return {
    action,
    report: {
      ok: !problems.some((p) => p.severity === "block"),
      problems,
      adjustments,
      validatedAt: new Date().toISOString(),
      stateHash: facts.stateHash,
      stateSignature: stateSignature(facts),
    },
  };
}

export type StaleReason = "state_changed" | "expired" | null;

/**
 * How much the world moved since the proposal was made. Deterministic: the
 * grading rules live in state-grade.ts and no AI can soften them.
 */
export function gradeRecommendationChange(
  record: RecommendationRecord,
  facts: AdvisorFacts,
): ChangeGrade {
  if (!record.validation) return "material";
  if (record.validation.stateHash === facts.stateHash) return "none";
  return gradeStateChange(record.validation.stateSignature, stateSignature(facts));
}

/**
 * Approval-time check: has the world moved *enough* to matter? Minor drift no
 * longer forces the player to approve the same advice twice; material and
 * critical changes still stop and revalidate.
 */
export function checkStale(
  record: RecommendationRecord,
  facts: AdvisorFacts,
  now: number = Date.now(),
): StaleReason {
  if (Date.parse(record.expiresAt) <= now) return "expired";
  const grade = gradeRecommendationChange(record, facts);
  return grade === "material" || grade === "critical" ? "state_changed" : null;
}