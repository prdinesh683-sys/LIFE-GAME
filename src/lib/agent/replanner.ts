import type { AdvisorFacts } from "../advisor/advisor-facts";
import { detectMaterialChanges, isMaterialChange, type MaterialChange } from "../advisor/advisor-feedback";
import type { PlanRecord, TaskRecord } from "./agent-types";
import { planStale } from "./plan-validation";

/**
 * PHASE 4C — replanning.
 *
 * The agent may PROPOSE a replan; it never silently rewrites an approved plan.
 * Detection is deterministic and reuses the Phase 4A material-change engine.
 */

export type ReplanReason =
  | "state_changed"
  | "task_failed"
  | "dependency_blocked"
  | "user_modified"
  | "goal_changed";

export interface ReplanVerdict {
  needed: boolean;
  reason: ReplanReason | null;
  changes: MaterialChange[];
  detail: string;
}

export function assessReplan(input: {
  plan: PlanRecord;
  tasks: TaskRecord[];
  facts: AdvisorFacts;
}): ReplanVerdict {
  const changes = detectMaterialChanges(input.plan.materialSnapshot, input.facts);

  const failed = input.tasks.find((t) => t.status === "failed");
  if (failed) {
    return {
      needed: true,
      reason: "task_failed",
      changes,
      detail: `"${failed.title}" failed repeatedly: ${failed.lastError ?? "unknown error"}.`,
    };
  }

  const blocked = input.tasks.find(
    (t) => t.status === "blocked" && t.dependencyIds.some((id) => {
      const dep = input.tasks.find((x) => x.id === id);
      return !dep || dep.status === "failed" || dep.status === "cancelled";
    }),
  );
  if (blocked) {
    return {
      needed: true,
      reason: "dependency_blocked",
      changes,
      detail: `"${blocked.title}" can never become ready — a dependency will not complete.`,
    };
  }

  if (isMaterialChange(changes) || planStale(input.plan, input.facts)) {
    return {
      needed: true,
      reason: "state_changed",
      changes,
      detail: changes.length
        ? changes.map((c) => c.detail).join(" ")
        : "Your state moved since this plan was validated.",
    };
  }

  return { needed: false, reason: null, changes, detail: "" };
}

/**
 * A modification is "material" when it adds or changes state-changing work.
 * Reordering or skipping only requires revalidation, not a fresh approval.
 */
export function modificationNeedsApproval(
  before: TaskRecord[],
  after: TaskRecord[],
): boolean {
  const writeKey = (tasks: TaskRecord[]) =>
    tasks
      .filter((t) => t.permissionClass !== "READ" && t.status !== "skipped" && t.status !== "cancelled")
      .map((t) => `${t.id}:${JSON.stringify(t.action)}`)
      .sort()
      .join("|");
  const beforeKey = writeKey(before);
  const afterKey = writeKey(after);
  if (beforeKey === afterKey) return false;
  // Removing work never needs re-approval; adding or changing it does.
  const beforeSet = new Set(beforeKey.split("|").filter(Boolean));
  return afterKey
    .split("|")
    .filter(Boolean)
    .some((entry) => !beforeSet.has(entry));
}
