import { checkGraph } from "./dependency-graph";
import type { TaskRecord } from "./agent-types";

/**
 * Agent right-sizing (Phase 5, item 5).
 *
 * A plan should exist only when the work genuinely needs sequencing. One or two
 * actions are a recommendation; three or more *dependent* actions are a plan.
 * The rule is deterministic — the agent never gets to decide it is needed just
 * because it can produce a plan.
 */

export type WorkShape = "direct_action" | "plan";

export interface RightSizeVerdict {
  shape: WorkShape;
  /** Plain-language reason shown to the user, never internal vocabulary. */
  reason: string;
  writeActions: number;
  dependentActions: number;
}

export function rightSize(tasks: Pick<TaskRecord, "id" | "dependencyIds" | "permissionClass">[]): RightSizeVerdict {
  const writes = tasks.filter((t) => t.permissionClass !== "READ");
  const ids = new Set(tasks.map((t) => t.id));
  const dependent = tasks.filter((t) => (t.dependencyIds ?? []).some((d) => ids.has(d))).length;

  if (writes.length >= 3 && dependent >= 1) {
    return {
      shape: "plan",
      reason: "This goal needs several steps that depend on each other, so it becomes a plan.",
      writeActions: writes.length,
      dependentActions: dependent,
    };
  }

  // Two actions earn a plan only when the sequencing genuinely matters: they are
  // chained *and* one of them takes over your attention when it runs.
  const chainedHighImpact =
    writes.length === 2 &&
    dependent >= 1 &&
    writes.some((t) => t.permissionClass === "HIGH_IMPACT");
  if (chainedHighImpact) {
    return {
      shape: "plan",
      reason: "These two steps must happen in order and one of them takes over your time.",
      writeActions: writes.length,
      dependentActions: dependent,
    };
  }

  return {
    shape: "direct_action",
    reason:
      writes.length <= 1
        ? "This is a single action — no plan needed."
        : "These two actions stand on their own, so they don't need a plan.",
    writeActions: writes.length,
    dependentActions: dependent,
  };
}


/** Guard used before persisting a proposal: a cyclic graph is never a plan. */
export function planIsWellFormed(tasks: TaskRecord[]): boolean {
  return checkGraph(tasks).length === 0;
}
