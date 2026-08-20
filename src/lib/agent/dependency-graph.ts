import type { TaskRecord } from "./agent-types";

/**
 * PHASE 4C — deterministic dependency graph.
 *
 * Execution order is computed here, never by the AI. A task is ready only when
 * every dependency is genuinely complete (or deliberately skipped).
 */

export interface GraphNode {
  id: string;
  dependencyIds: string[];
}

export interface GraphProblem {
  code: "missing_dependency" | "cycle" | "self_dependency";
  message: string;
  taskIds: string[];
}

export function checkGraph(nodes: GraphNode[]): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const ids = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    for (const dep of node.dependencyIds) {
      if (dep === node.id) {
        problems.push({
          code: "self_dependency",
          message: `Task ${node.id} depends on itself.`,
          taskIds: [node.id],
        });
      } else if (!ids.has(dep)) {
        problems.push({
          code: "missing_dependency",
          message: `Task ${node.id} depends on unknown task ${dep}.`,
          taskIds: [node.id],
        });
      }
    }
  }

  const cycle = findCycle(nodes);
  if (cycle.length) {
    problems.push({
      code: "cycle",
      message: `Dependency cycle: ${cycle.join(" → ")}.`,
      taskIds: cycle,
    });
  }

  return problems;
}

export function hasCycle(nodes: GraphNode[]): boolean {
  return findCycle(nodes).length > 0;
}

export function findCycle(nodes: GraphNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  let cycle: string[] = [];

  const visit = (id: string): boolean => {
    const current = state.get(id);
    if (current === "done") return false;
    if (current === "visiting") {
      const start = stack.indexOf(id);
      cycle = [...stack.slice(start === -1 ? 0 : start), id];
      return true;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of byId.get(id)?.dependencyIds ?? []) {
      if (byId.has(dep) && visit(dep)) return true;
    }
    stack.pop();
    state.set(id, "done");
    return false;
  };

  for (const node of nodes) {
    if (visit(node.id)) break;
  }
  return cycle;
}

/** Dependency-respecting order; returns null when the graph is cyclic. */
export function topologicalOrder(nodes: GraphNode[]): string[] | null {
  if (hasCycle(nodes)) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  const order: string[] = [];

  const visit = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    for (const dep of byId.get(id)?.dependencyIds ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    order.push(id);
  };

  for (const node of nodes) visit(node.id);
  return order;
}

const SETTLED = new Set(["completed", "skipped"]);

export function dependenciesSatisfied(task: TaskRecord, tasks: TaskRecord[]): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return task.dependencyIds.every((id) => {
    const dep = byId.get(id);
    return dep ? SETTLED.has(dep.status) : false;
  });
}

/** Tasks whose dependencies are settled and whose state permits execution. */
export function readyTasks(tasks: TaskRecord[]): TaskRecord[] {
  const order = topologicalOrder(tasks.map((t) => ({ id: t.id, dependencyIds: t.dependencyIds })));
  const rank = new Map((order ?? tasks.map((t) => t.id)).map((id, index) => [id, index]));
  return tasks
    .filter(
      (task) =>
        (task.status === "ready" || task.status === "approved" || task.status === "planned") &&
        dependenciesSatisfied(task, tasks),
    )
    .sort((a, b) => (rank.get(a.id) ?? a.order) - (rank.get(b.id) ?? b.order));
}

export function blockedTasks(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.filter(
    (task) =>
      (task.status === "planned" || task.status === "ready" || task.status === "blocked") &&
      !dependenciesSatisfied(task, tasks),
  );
}

/**
 * Controlled parallelism: only independent READ-only work may run together.
 * Every write is serialised, so the deterministic engines see one change at a
 * time.
 */
export function parallelBatch(tasks: TaskRecord[]): TaskRecord[] {
  const ready = readyTasks(tasks);
  if (!ready.length) return [];
  const first = ready[0]!;
  if (first.permissionClass !== "READ") return [first];
  const batch = ready.filter((t) => t.permissionClass === "READ");
  // Read tasks in the same batch must not depend on each other.
  const ids = new Set(batch.map((t) => t.id));
  return batch.filter((t) => !t.dependencyIds.some((d) => ids.has(d)));
}
