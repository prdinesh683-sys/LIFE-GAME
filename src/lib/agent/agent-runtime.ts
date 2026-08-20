import type { AdvisorFacts } from "../advisor/advisor-facts";
import type { PersonalBlueprint } from "../game/types";
import { newId } from "../game/quest-engine";
import {
  idempotencyKeyFor,
  needsIndividualApproval,
  requireAction,
  type ActionServices,
} from "./action-registry";
import { alreadyExecuted, attemptsFor, completedEntry } from "./action-ledger";
import { canTaskTransition, type ActionRecordRow, type TaskRecord } from "./agent-types";
import { dependenciesSatisfied } from "./dependency-graph";
import { taskStale } from "./plan-validation";
import { decideAfterFailure, recoveryProposal } from "./retry-policy";

/**
 * PHASE 4C — agent runtime.
 *
 * The runtime orders and executes work. It holds NO repository handle, NO React
 * state and NO arbitrary function map: it can only call registered typed
 * actions, which in turn call the existing deterministic application services.
 */

export type ExecutionVerdict =
  | { kind: "executed"; task: TaskRecord; action: ActionRecordRow; summary: string }
  | { kind: "already_done"; task: TaskRecord; action: ActionRecordRow; summary: string }
  | { kind: "blocked"; task: TaskRecord; reason: string }
  | { kind: "needs_approval"; task: TaskRecord; reason: string }
  | { kind: "stale"; task: TaskRecord; reason: string }
  | { kind: "failed"; task: TaskRecord; action: ActionRecordRow; error: string; escalated: boolean; recovery: string | null };

export interface ExecuteInput {
  task: TaskRecord;
  tasks: TaskRecord[];
  planId: string;
  agentRunId: string | null;
  facts: AdvisorFacts;
  blueprint: PersonalBlueprint | null;
  services: ActionServices;
  ledger: ActionRecordRow[];
  /** Set when the user has just approved this specific high-impact action. */
  actionApprovalId?: string | null;
  /** Plan-level approval reference (never sufficient for HIGH_IMPACT). */
  planApprovalId: string | null;
}

function stamp<T extends { updatedAt: string }>(value: T): T {
  return { ...value, updatedAt: new Date().toISOString() };
}

function transition(task: TaskRecord, status: TaskRecord["status"]): TaskRecord {
  if (!canTaskTransition(task.status, status)) {
    return stamp({ ...task, status: "needs_replan" });
  }
  return stamp({ ...task, status });
}

export async function executeTask(input: ExecuteInput): Promise<ExecutionVerdict> {
  const { task, facts, services } = input;

  if (task.status === "completed" || task.status === "skipped" || task.status === "cancelled") {
    return { kind: "blocked", task, reason: "Task is already settled." };
  }

  if (!dependenciesSatisfied(task, input.tasks)) {
    return { kind: "blocked", task: transition(task, "blocked"), reason: "Dependencies are not finished." };
  }

  // High-impact work is never covered by plan-level approval.
  if (needsIndividualApproval(task.action) && !input.actionApprovalId) {
    return {
      kind: "needs_approval",
      task: transition(task, "awaiting_approval"),
      reason: "This action changes something important and needs its own approval.",
    };
  }
  if (!needsIndividualApproval(task.action) && !input.planApprovalId && task.permissionClass !== "READ") {
    return {
      kind: "needs_approval",
      task: transition(task, "awaiting_approval"),
      reason: "The plan has not been approved yet.",
    };
  }

  // Freshness: a task validated against different state must not run.
  if (taskStale(task, facts)) {
    const revalidated = requireAction(task.action.type).validate(task.action, {
      facts,
      blueprint: input.blueprint,
    });
    if (!revalidated.report.ok) {
      return {
        kind: "stale",
        task: stamp({
          ...task,
          status: "needs_replan",
          validation: revalidated.report,
          stateHash: facts.stateHash,
        }),
        reason: revalidated.report.problems[0]?.message ?? "Your state changed.",
      };
    }
    // Adjusted but still possible: continue against the fresh action.
    input.task.action = revalidated.action;
    input.task.validation = revalidated.report;
    input.task.stateHash = facts.stateHash;
  }

  const definition = requireAction(task.action.type);
  const key = task.idempotencyKey || idempotencyKeyFor(input.planId, task.id, task.action);

  const done = completedEntry(input.ledger, key);
  if (done && alreadyExecuted(input.ledger, key)) {
    return {
      kind: "already_done",
      task: stamp({
        ...task,
        status: "completed",
        resultSummary: done.result ?? "Already executed.",
        completedAt: done.completedAt ?? new Date().toISOString(),
      }),
      action: done,
      summary: done.result ?? "Already executed — nothing was repeated.",
    };
  }

  const validated = definition.validate(task.action, { facts, blueprint: input.blueprint });
  const now = new Date().toISOString();
  const record: ActionRecordRow = {
    id: newId("act"),
    agentRunId: input.agentRunId,
    planId: input.planId,
    taskId: task.id,
    actionType: task.action.type,
    permissionClass: task.permissionClass,
    status: "executing",
    idempotencyKey: key,
    retryCount: attemptsFor(input.ledger, key),
    affectedEntityIds: definition.affectedEntities(validated.action),
    expectedImpact: definition.expectedImpact(validated.action),
    result: null,
    error: null,
    validation: validated.report,
    approvalRef: input.actionApprovalId ?? input.planApprovalId,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
  };

  if (!validated.report.ok) {
    return {
      kind: "stale",
      task: stamp({ ...task, status: "needs_replan", validation: validated.report }),
      reason: validated.report.problems[0]?.message ?? "No longer valid.",
    };
  }

  const attempts = task.attempts + 1;
  try {
    const result = await definition.execute(validated.action, services);
    return {
      kind: "executed",
      summary: result.summary,
      action: {
        ...record,
        status: "completed",
        result: result.summary,
        affectedEntityIds: result.affectedEntityIds,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      task: stamp({
        ...task,
        status: "completed",
        attempts,
        action: validated.action,
        validation: validated.report,
        stateHash: facts.stateHash,
        resultSummary: result.summary,
        startedAt: task.startedAt ?? now,
        completedAt: new Date().toISOString(),
        lastError: null,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    const verdict = decideAfterFailure(attempts, message);
    return {
      kind: "failed",
      error: message,
      escalated: verdict.decision === "escalate",
      recovery: verdict.decision === "escalate" ? recoveryProposal(task.title, message) : null,
      action: {
        ...record,
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      task: stamp({
        ...task,
        status: verdict.decision === "escalate" ? "failed" : "ready",
        attempts,
        lastError: verdict.message,
      }),
    };
  }
}

/** Bounded checkpoint note after each executed batch. */
export function checkpointNote(executed: number, remaining: number): string {
  if (!executed) return "Nothing executed — state re-checked.";
  return `${executed} task(s) executed, ${remaining} remaining. State re-read before continuing.`;
}
