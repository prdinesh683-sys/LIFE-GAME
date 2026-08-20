import type { StateSignature } from "../advisor/state-grade";
import type { EvidenceItem, RecommendationAction, ValidationReport } from "../advisor/advisor-types";
import type { MaterialSnapshot } from "../advisor/advisor-feedback";

/**
 * PHASE 4C — Agent domain model.
 *
 * The agent is a planner + orchestrator, never an authority. Everything here is
 * a proposal, an approval record, or an audit record. State changes happen only
 * through registered typed actions, which call the existing deterministic
 * application services.
 */

/* ------------------------------------------------------------------ actions */

/**
 * The only shapes the agent may ask the deterministic layer to execute.
 * The write shapes are deliberately the Phase 4A `RecommendationAction` union
 * so validation is shared rather than duplicated.
 */
export type AgentAction =
  | RecommendationAction
  | { type: "review"; note: string }
  | { type: "start_quest"; questId: string };

export type PermissionClass = "READ" | "LOW_RISK_WRITE" | "HIGH_IMPACT";

export const PERMISSION_LABELS: Record<PermissionClass, string> = {
  READ: "Read only",
  LOW_RISK_WRITE: "Low-risk change",
  HIGH_IMPACT: "High impact — needs its own approval",
};

/* ------------------------------------------------------------ state machines */

export type PlanStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "needs_replan"
  | "expired";

export type TaskStatus =
  | "draft"
  | "planned"
  | "awaiting_approval"
  | "approved"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "skipped"
  | "needs_replan";

export type ActionStatus =
  | "proposed"
  | "validated"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "stale"
  | "rejected";

export const PLAN_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["awaiting_approval", "cancelled", "expired", "needs_replan"],
  awaiting_approval: ["approved", "cancelled", "expired", "needs_replan"],
  approved: ["active", "cancelled", "needs_replan", "expired"],
  active: ["paused", "completed", "failed", "cancelled", "needs_replan"],
  paused: ["active", "cancelled", "needs_replan"],
  needs_replan: ["awaiting_approval", "cancelled", "expired"],
  completed: [],
  failed: ["needs_replan", "cancelled"],
  cancelled: [],
  expired: ["needs_replan"],
};

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["awaiting_approval", "ready", "blocked", "cancelled", "skipped", "needs_replan"],
  awaiting_approval: ["approved", "cancelled", "skipped", "needs_replan"],
  approved: ["ready", "running", "cancelled", "skipped", "needs_replan"],
  ready: ["running", "blocked", "cancelled", "skipped", "needs_replan", "awaiting_approval"],
  running: ["completed", "failed", "cancelled", "needs_replan"],
  blocked: ["ready", "cancelled", "skipped", "needs_replan"],
  failed: ["ready", "cancelled", "needs_replan", "skipped"],
  completed: [],
  cancelled: [],
  skipped: [],
  needs_replan: ["planned", "cancelled", "skipped"],
};

export const ACTION_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  proposed: ["validated", "rejected", "cancelled", "stale"],
  validated: ["awaiting_approval", "approved", "stale", "cancelled", "rejected"],
  awaiting_approval: ["approved", "rejected", "cancelled", "stale"],
  approved: ["executing", "stale", "cancelled"],
  executing: ["completed", "failed", "cancelled"],
  failed: ["approved", "cancelled", "stale"],
  completed: [],
  cancelled: [],
  stale: ["validated", "cancelled"],
  rejected: [],
};

export function canPlanTransition(from: PlanStatus, to: PlanStatus): boolean {
  return from === to || (PLAN_TRANSITIONS[from] ?? []).includes(to);
}

export function canTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || (TASK_TRANSITIONS[from] ?? []).includes(to);
}

export function canActionTransition(from: ActionStatus, to: ActionStatus): boolean {
  return from === to || (ACTION_TRANSITIONS[from] ?? []).includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(kind: string, from: string, to: string) {
    super(`Invalid ${kind} transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/* ----------------------------------------------------------------- records */

export type PlanVariant = "recommended" | "alternative" | "conservative";

/** How a plan left the live set — a user rejection is never a supersede. */
export type PlanCloseReason = "rejected" | "superseded" | "cancelled";

export const PLAN_CLOSE_REASON_LABELS: Record<PlanCloseReason, string> = {
  rejected: "Declined by you",
  superseded: "Superseded by another plan",
  cancelled: "Cancelled",
};

export const PLAN_VARIANT_LABELS: Record<PlanVariant, string> = {
  recommended: "Recommended",
  alternative: "Alternative",
  conservative: "Low-effort",
};

export interface PlanMilestone {
  id: string;
  title: string;
}

export interface AgentRunRecord {
  id: string;
  planId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string | null;
  checkpoints: { at: string; note: string }[];
  updatedAt: string;
}

export interface PlanRecord {
  id: string;
  agentRunId: string | null;
  /** Deterministic identity: same intent + trigger + state version = same plan. */
  signature: string;
  variant: PlanVariant;
  /** Plans proposed together share this id, so alternatives stay grouped. */
  proposalGroupId: string;
  goalText: string;
  title: string;
  rationale: string;
  status: PlanStatus;
  confidence: number;
  evidence: EvidenceItem[];
  constraints: string[];
  assumptions: string[];
  tradeOffs: string[];
  expectedImpact: string;
  milestones: PlanMilestone[];
  horizonDays: number;
  source: "ai" | "engine";
  brain: string | null;
  validation: ValidationReport | null;
  materialSnapshot: MaterialSnapshot;
  /** Recommendation this plan grew out of, when the Advisor started it. */
  sourceRecommendationId: string | null;
  usedDriveContext: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  decidedAt: string | null;
  /**
   * Why a plan stopped being live. Keeps an explicit user rejection distinct
   * from a sibling superseded by another approval or a plan cancelled mid-run.
   * Absent on records written before this distinction existed.
   */
  closeReason?: PlanCloseReason | null;
}

export interface TaskRecord {
  id: string;
  planId: string;
  milestoneId: string | null;
  title: string;
  detail: string;
  order: number;
  dependencyIds: string[];
  status: TaskStatus;
  action: AgentAction;
  permissionClass: PermissionClass;
  estimatedMinutes: number;
  attempts: number;
  lastError: string | null;
  approvalId: string | null;
  idempotencyKey: string;
  /** State fingerprint the task was validated against. */
  stateHash: string;
  /** Graded-staleness inputs captured at validation time (optional pre-Phase 5). */
  stateSignature?: StateSignature;
  validation: ValidationReport | null;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ActionRecordRow {
  id: string;
  agentRunId: string | null;
  planId: string;
  taskId: string;
  actionType: AgentAction["type"];
  permissionClass: PermissionClass;
  status: ActionStatus;
  idempotencyKey: string;
  retryCount: number;
  affectedEntityIds: string[];
  expectedImpact: string;
  result: string | null;
  error: string | null;
  validation: ValidationReport | null;
  approvalRef: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export type AgentOutcomeResult = "succeeded" | "partial" | "failed" | "cancelled";

export interface AgentOutcomeRecord {
  id: string;
  planId: string;
  agentRunId: string | null;
  result: AgentOutcomeResult;
  note: string;
  metrics: {
    tasksTotal: number;
    tasksCompleted: number;
    tasksFailed: number;
    tasksSkipped: number;
    retries: number;
  };
  measuredAt: string;
}

export type AgentFeedbackKind =
  | "useful"
  | "wrong_priority"
  | "wrong_timing"
  | "incorrect_assumption"
  | "too_difficult"
  | "not_relevant"
  | "other";

export const AGENT_FEEDBACK_LABELS: Record<AgentFeedbackKind, string> = {
  useful: "Useful",
  wrong_priority: "Wrong priority",
  wrong_timing: "Wrong timing",
  incorrect_assumption: "Incorrect assumption",
  too_difficult: "Too difficult",
  not_relevant: "Not relevant",
  other: "Other",
};

export interface AgentFeedbackRecord {
  id: string;
  planId: string;
  taskId: string | null;
  kind: AgentFeedbackKind;
  note: string;
  createdAt: string;
}

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Waiting for you",
  approved: "Approved",
  active: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_replan: "Needs replanning",
  expired: "Expired",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  awaiting_approval: "Needs approval",
  approved: "Approved",
  ready: "Ready",
  running: "Running",
  completed: "Done",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
  needs_replan: "Needs replanning",
};
