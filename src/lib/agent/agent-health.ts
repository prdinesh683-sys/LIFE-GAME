import type {
  ActionRecordRow,
  AgentOutcomeRecord,
  PlanRecord,
  TaskRecord,
} from "./agent-types";

/**
 * PHASE 4C — deterministic agent health.
 *
 * Every number here is counted from real records. The AI may explain these
 * metrics; it can never invent them.
 */

export interface AgentHealthReport {
  plansTotal: number;
  plansApproved: number;
  plansRejected: number;
  plansSuperseded: number;
  plansCompleted: number;
  approvalRate: number;
  rejectionRate: number;
  completionRate: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksStalled: number;
  retries: number;
  replans: number;
  successRate: number;
  failureRate: number;
  outcomeQuality: number | null;
}

function rate(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100) / 100;
}

export function buildAgentHealth(input: {
  plans: PlanRecord[];
  tasks: TaskRecord[];
  actions: ActionRecordRow[];
  outcomes: AgentOutcomeRecord[];
}): AgentHealthReport {
  // Only real user decisions count: an approval or an explicit rejection.
  // Siblings superseded by another approval, and plans cancelled mid-run, are
  // neither — counting them made the two rates sum above 100%.
  const approved = input.plans.filter((p) => p.approvedAt != null);
  const rejected = input.plans.filter(
    (p) => p.approvedAt == null && p.status === "cancelled" && p.closeReason === "rejected",
  );
  const superseded = input.plans.filter((p) => p.closeReason === "superseded").length;
  const decided = approved.length + rejected.length;
  const completed = input.plans.filter((p) => p.status === "completed");
  const replans = input.plans.filter((p) => p.status === "needs_replan").length;

  const tasksCompleted = input.tasks.filter((t) => t.status === "completed").length;
  const tasksFailed = input.tasks.filter((t) => t.status === "failed").length;
  const tasksStalled = input.tasks.filter(
    (t) => t.status === "blocked" || t.status === "needs_replan",
  ).length;
  const retries = input.actions.reduce((sum, a) => sum + a.retryCount, 0);

  const finishedTasks = tasksCompleted + tasksFailed;
  const quality = input.outcomes.length
    ? rate(
        input.outcomes.filter((o) => o.result === "succeeded").length,
        input.outcomes.length,
      )
    : null;

  return {
    plansTotal: input.plans.length,
    plansApproved: approved.length,
    plansRejected: rejected.length,
    plansCompleted: completed.length,
    plansSuperseded: superseded,
    approvalRate: rate(approved.length, decided),
    rejectionRate: rate(rejected.length, decided),
    completionRate: rate(completed.length, approved.length),
    tasksTotal: input.tasks.length,
    tasksCompleted,
    tasksFailed,
    tasksStalled,
    retries,
    replans,
    successRate: rate(tasksCompleted, finishedTasks),
    failureRate: rate(tasksFailed, finishedTasks),
    outcomeQuality: quality,
  };
}

export function summariseOutcome(input: {
  tasks: TaskRecord[];
  actions: ActionRecordRow[];
}): Pick<AgentOutcomeRecord, "result" | "note" | "metrics"> {
  const tasksCompleted = input.tasks.filter((t) => t.status === "completed").length;
  const tasksFailed = input.tasks.filter((t) => t.status === "failed").length;
  const tasksSkipped = input.tasks.filter((t) => t.status === "skipped").length;
  const retries = input.actions.reduce((sum, a) => sum + a.retryCount, 0);
  const result: AgentOutcomeRecord["result"] =
    tasksFailed > 0 && tasksCompleted === 0
      ? "failed"
      : tasksFailed > 0 || tasksSkipped > 0
        ? "partial"
        : "succeeded";
  return {
    result,
    note: `${tasksCompleted} of ${input.tasks.length} tasks completed${tasksFailed ? `, ${tasksFailed} failed` : ""}.`,
    metrics: {
      tasksTotal: input.tasks.length,
      tasksCompleted,
      tasksFailed,
      tasksSkipped,
      retries,
    },
  };
}
