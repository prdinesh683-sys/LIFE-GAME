import type { AdvisorFacts } from "../advisor/advisor-facts";
import type { PersonalBlueprint } from "../game/types";
import type { ValidationProblem, ValidationReport } from "../advisor/advisor-types";
import { gradeStateChange, stateSignature, type ChangeGrade } from "../advisor/state-grade";
import { permissionOf, requireAction, lookupAction } from "./action-registry";
import { checkGraph } from "./dependency-graph";
import type { PlanRecord, TaskRecord } from "./agent-types";

/**
 * PHASE 4C — deterministic plan feasibility validation.
 *
 * The AI proposes; this decides whether reality permits it. Nothing reaches the
 * approval screen without passing here, and everything is re-checked at
 * approval and again immediately before execution.
 */

export interface PlanValidationInput {
  plan: PlanRecord;
  tasks: TaskRecord[];
  facts: AdvisorFacts;
  blueprint: PersonalBlueprint | null;
  /** Signatures of other live plans — equivalent plans converge, not duplicate. */
  existingSignatures?: string[];
}

export interface PlanValidationOutput {
  report: ValidationReport;
  /** Tasks with deterministically adjusted actions and per-task validation. */
  tasks: TaskRecord[];
}

export function validatePlan(input: PlanValidationInput): PlanValidationOutput {
  const problems: ValidationProblem[] = [];
  const adjustments: string[] = [];
  const now = new Date().toISOString();
  const { facts, blueprint } = input;

  if (!input.tasks.length) {
    problems.push({ code: "no_tasks", message: "The plan has no tasks.", severity: "block" });
  }

  if (input.existingSignatures?.includes(input.plan.signature)) {
    problems.push({
      code: "duplicate_plan",
      message: "An equivalent plan is already open.",
      severity: "block",
    });
  }

  for (const problem of checkGraph(
    input.tasks.map((t) => ({ id: t.id, dependencyIds: t.dependencyIds })),
  )) {
    problems.push({ code: problem.code, message: problem.message, severity: "block" });
  }

  const tasks: TaskRecord[] = [];
  for (const task of input.tasks) {
    const definition = lookupAction(task.action.type);
    if (!definition) {
      problems.push({
        code: "unknown_action",
        message: `Task "${task.title}" uses an unknown action.`,
        severity: "block",
      });
      tasks.push({ ...task, validation: null });
      continue;
    }
    const validated = requireAction(task.action.type).validate(task.action, { facts, blueprint });
    if (!validated.report.ok) {
      problems.push({
        code: "task_invalid",
        message: `Task "${task.title}": ${validated.report.problems[0]?.message ?? "not currently possible"}.`,
        severity: "block",
      });
    }
    for (const adjustment of validated.report.adjustments) {
      adjustments.push(`${task.title}: ${adjustment}`);
    }
    tasks.push({
      ...task,
      action: validated.action,
      permissionClass: permissionOf(validated.action),
      validation: validated.report,
      stateHash: facts.stateHash,
      stateSignature: stateSignature(facts),
    });
  }

  // Resource feasibility: today's write work must fit today's window.
  const available = facts.availableMinutes;
  const todayMinutes = tasks
    .filter((t) => t.permissionClass !== "READ" && t.order === 0)
    .reduce((sum, t) => sum + t.estimatedMinutes, 0);
  if (available != null && available > 0 && todayMinutes > available) {
    problems.push({
      code: "schedule_overflow",
      message: `The first step needs ${todayMinutes} minutes but only ${available} are available today.`,
      severity: "adjust",
    });
    adjustments.push("Later tasks were left for the following days.");
  }

  if (input.plan.horizonDays > 14) {
    problems.push({
      code: "horizon_too_long",
      message: "Long-horizon plans stay proposals and are executed in smaller validated phases.",
      severity: "adjust",
    });
  }

  const antiGoal = (blueprint?.antiGoals ?? []).find(
    (goal) =>
      goal.trim().length > 3 &&
      `${input.plan.title} ${input.plan.goalText}`.toLowerCase().includes(goal.trim().toLowerCase()),
  );
  if (antiGoal) {
    problems.push({
      code: "anti_goal",
      message: `This plan works against your stated anti-goal: ${antiGoal}.`,
      severity: "block",
    });
  }

  const report: ValidationReport = {
    ok: !problems.some((p) => p.severity === "block"),
    problems,
    adjustments,
    validatedAt: now,
    stateHash: facts.stateHash,
    stateSignature: stateSignature(facts),
  };

  return { report, tasks };
}

export type StaleReason = "state_changed" | "expired" | null;

/** Graded change for a whole plan (deterministic; see advisor/state-grade.ts). */
export function gradePlanChange(plan: PlanRecord, facts: AdvisorFacts): ChangeGrade {
  if (!plan.validation) return "material";
  if (plan.validation.stateHash === facts.stateHash) return "none";
  return gradeStateChange(plan.validation.stateSignature, stateSignature(facts));
}

export function gradeTaskChange(task: TaskRecord, facts: AdvisorFacts): ChangeGrade {
  if (task.stateHash === facts.stateHash) return "none";
  return gradeStateChange(task.stateSignature ?? task.validation?.stateSignature, stateSignature(facts));
}

/**
 * A plan validated against a *materially* different state must never execute.
 * Minor drift (one more completion, a point of momentum) no longer invalidates
 * an approved plan; material and critical changes still do.
 */
export function planStale(plan: PlanRecord, facts: AdvisorFacts): StaleReason {
  const grade = gradePlanChange(plan, facts);
  return grade === "material" || grade === "critical" ? "state_changed" : null;
}

export function taskStale(task: TaskRecord, facts: AdvisorFacts): StaleReason {
  const grade = gradeTaskChange(task, facts);
  return grade === "material" || grade === "critical" ? "state_changed" : null;
}

/** Deterministic priority ranking; the AI may explain it, never compute it. */
export function priorityScore(task: TaskRecord, facts: AdvisorFacts): number {
  let score = 100 - task.order * 10;
  if (task.permissionClass === "READ") score += 5;
  if (facts.runAtRisk && task.estimatedMinutes <= 15) score += 20;
  if (facts.energy != null && facts.energy <= 2 && task.estimatedMinutes > 30) score -= 25;
  if (facts.availableMinutes != null && task.estimatedMinutes > facts.availableMinutes) score -= 30;
  return score;
}
