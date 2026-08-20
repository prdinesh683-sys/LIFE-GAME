import { describe, expect, it } from "vitest";

import { buildAdvisorFacts } from "../../advisor/advisor-facts";
import { materialSnapshotOf } from "../../advisor/advisor-feedback";
import { DEFAULT_ECONOMY } from "../../game/config";
import { dayKey } from "../../game/run-engine";
import type { DailyState, GameSnapshot, Profile, Settings } from "../../game/types";
import { alreadyExecuted, attemptsFor, dedupeByKey } from "../action-ledger";
import {
  ACTION_TYPES,
  idempotencyKeyFor,
  needsIndividualApproval,
  parseAction,
  permissionOf,
  requireAction,
  type ActionServices,
} from "../action-registry";
import { buildAgentHealth, summariseOutcome } from "../agent-health";
import { executeTask } from "../agent-runtime";
import type {
  ActionRecordRow,
  AgentAction,
  PlanRecord,
  TaskRecord,
} from "../agent-types";
import { canPlanTransition, canTaskTransition } from "../agent-types";
import {
  blockedTasks,
  checkGraph,
  dependenciesSatisfied,
  parallelBatch,
  readyTasks,
  topologicalOrder,
} from "../dependency-graph";
import { buildPlanDrafts, materialisePlan } from "../planner";
import { planStale, validatePlan } from "../plan-validation";
import { assessReplan, modificationNeedsApproval } from "../replanner";
import { decideAfterFailure, MAX_ATTEMPTS } from "../retry-policy";

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

function makeSettings(): Settings {
  return {
    id: "settings",
    deviceId: "device-test",
    onboardingComplete: true,
    theme: "dark",
    reducedMotion: false,
    sound: true,
    economy: DEFAULT_ECONOMY,
    ai: {
      mode: "off",
      phoneLocal: { enabled: false, endpoint: "", model: "", apiKey: "" },
      ollama: { enabled: false, endpoint: "", model: "", apiKey: "" },
      cloud: { enabled: false, endpoint: "", model: "", apiKey: "", provider: "" },
      jobBrains: { chat: "auto", analysis: "auto", quest: "auto", event: "auto", planning: "auto" },
    },
  };
}

function makeSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  const profile: Profile = {
    id: "profile",
    displayName: "Player",
    title: "Newcomer",
    avatarSeed: "seed",
    sparks: 100,
    lifetimeSparks: 100,
    rank: 2,
    chapter: "Chapter I",
    currentRun: 3,
    bestRun: 5,
    lastActiveDay: dayKey(),
    combo: 1,
    comboUpdatedAt: null,
    createdAt: iso(200),
  };
  const today: DailyState = {
    id: dayKey(),
    energy: 3,
    mood: 3,
    availableMinutes: 90,
    note: "",
    updatedAt: new Date().toISOString(),
  };
  return {
    profile,
    settings: makeSettings(),
    blueprint: null,
    destinations: [],
    milestones: [],
    boosts: [],
    drains: [],
    quests: [],
    questRuns: [],
    dailyStates: [today],
    events: [],
    attributes: [],
    trophies: [],
    ...overrides,
  };
}

const facts = () => buildAdvisorFacts(makeSnapshot(), 45);

function makeTask(partial: Partial<TaskRecord> & { id: string }): TaskRecord {
  const action: AgentAction = partial.action ?? { type: "review", note: "Check in" };
  return {
    planId: "plan1",
    milestoneId: null,
    title: partial.title ?? partial.id,
    detail: "",
    order: partial.order ?? 0,
    dependencyIds: [],
    status: "ready",
    permissionClass: permissionOf(action),
    estimatedMinutes: 10,
    attempts: 0,
    lastError: null,
    approvalId: null,
    idempotencyKey: `key-${partial.id}`,
    stateHash: "st-old",
    validation: null,
    resultSummary: null,
    createdAt: iso(1),
    updatedAt: iso(1),
    startedAt: null,
    completedAt: null,
    ...partial,
    action,
  };
}

function servicesSpy(overrides: Partial<ActionServices> = {}) {
  const calls: string[] = [];
  const services: ActionServices = {
    createQuest: async (draft) => {
      calls.push(`createQuest:${draft.name}`);
      return { id: "q1", name: draft.name } as never;
    },
    startQuest: async (questId) => {
      calls.push(`startQuest:${questId}`);
      return { id: "run1" } as never;
    },
    saveBoost: async (boost) => {
      calls.push(`saveBoost:${boost.name}`);
    },
    saveDestination: async (destination) => {
      calls.push(`saveDestination:${destination.title}`);
    },
    addMemory: async (_kind, text) => {
      calls.push(`addMemory:${text}`);
    },
    ...overrides,
  };
  return { services, calls };
}

describe("dependency graph", () => {
  it("detects cycles, self dependencies and unknown dependencies", () => {
    const problems = checkGraph([
      { id: "a", dependencyIds: ["b"] },
      { id: "b", dependencyIds: ["a"] },
      { id: "c", dependencyIds: ["c"] },
      { id: "d", dependencyIds: ["zz"] },
    ]);
    expect(problems.some((p) => p.code === "cycle")).toBe(true);
    expect(problems.some((p) => p.code === "self_dependency")).toBe(true);
    expect(problems.some((p) => p.code === "missing_dependency")).toBe(true);
  });

  it("orders tasks deterministically when the graph is acyclic", () => {
    const order = topologicalOrder([
      { id: "c", dependencyIds: ["b"] },
      { id: "b", dependencyIds: ["a"] },
      { id: "a", dependencyIds: [] },
    ]);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("keeps a task blocked until its dependency is genuinely finished", () => {
    const first = makeTask({ id: "a" });
    const second = makeTask({ id: "b", dependencyIds: ["a"] });
    expect(dependenciesSatisfied(second, [first, second])).toBe(false);
    expect(readyTasks([first, second]).map((t) => t.id)).toEqual(["a"]);
    expect(blockedTasks([first, second]).map((t) => t.id)).toEqual(["b"]);

    const done = { ...first, status: "completed" as const };
    expect(dependenciesSatisfied(second, [done, second])).toBe(true);
  });

  it("only batches read-only work in parallel", () => {
    const read = makeTask({ id: "r1", action: { type: "review", note: "a" } });
    const read2 = makeTask({ id: "r2", order: 1, action: { type: "review", note: "b" } });
    expect(parallelBatch([read, read2]).length).toBe(2);

    const write = makeTask({
      id: "w1",
      action: {
        type: "create_quest",
        quest: {
          name: "Walk",
          description: "",
          durationMinutes: 10,
          difficulty: "easy",
          isRecovery: false,
        },
        startImmediately: false,
      },
    });
    expect(parallelBatch([write, read2]).map((t) => t.id)).toEqual(["w1"]);
  });
});

describe("action registry", () => {
  it("classifies permissions and requires individual approval for high impact", () => {
    expect(permissionOf({ type: "review", note: "" })).toBe("READ");
    expect(
      permissionOf({
        type: "create_quest",
        quest: { name: "x", description: "", durationMinutes: 5, difficulty: "easy", isRecovery: false },
        startImmediately: false,
      }),
    ).toBe("LOW_RISK_WRITE");
    expect(needsIndividualApproval({ type: "start_quest", questId: "q1" })).toBe(true);
    expect(needsIndividualApproval({ type: "review", note: "" })).toBe(false);
  });

  it("rejects unknown or malformed actions", () => {
    expect(parseAction({ type: "rm_rf", path: "/" })).toBeNull();
    expect(parseAction({ type: "create_quest" })).toBeNull();
    expect(() => requireAction("shell" as never)).toThrow();
    expect(ACTION_TYPES).not.toContain("shell");
  });

  it("produces a stable idempotency key for the same action", () => {
    const action: AgentAction = { type: "review", note: "same" };
    expect(idempotencyKeyFor("p", "t", action)).toBe(idempotencyKeyFor("p", "t", action));
    expect(idempotencyKeyFor("p", "t", action)).not.toBe(
      idempotencyKeyFor("p", "t2", action),
    );
  });
});

describe("state machines", () => {
  it("allows only legal transitions", () => {
    expect(canPlanTransition("awaiting_approval", "approved")).toBe(true);
    expect(canPlanTransition("completed", "active")).toBe(false);
    expect(canTaskTransition("ready", "running")).toBe(true);
    expect(canTaskTransition("completed", "running")).toBe(false);
  });
});

describe("planner and validation", () => {
  it("produces multiple validated alternatives for a goal", () => {
    const drafts = buildPlanDrafts({ goalText: "Run three times a week", facts: facts(), aiPlan: null });
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(drafts.map((d) => d.variant)).size).toBe(drafts.length);
    for (const draft of drafts) expect(draft.tasks.length).toBeGreaterThan(0);
  });

  it("validates feasibility and marks a plan stale when state moves", () => {
    const current = facts();
    const draft = buildPlanDrafts({ goalText: "Walk daily", facts: current, aiPlan: null })[0]!;
    const materialised = materialisePlan({
      draft,
      facts: current,
      proposalGroupId: "grp",
      source: "engine",
      brain: null,
      usedDriveContext: false,
    });
    const validated = validatePlan({
      plan: materialised.plan,
      tasks: materialised.tasks,
      facts: current,
      blueprint: null,
    });
    expect(validated.report.ok).toBe(true);

    const moved = buildAdvisorFacts(makeSnapshot({ profile: { ...makeSnapshot().profile, currentRun: 40 } }), 5);
    expect(planStale(materialised.plan, moved)).toBeTruthy();
  });
});

describe("retry policy and ledger", () => {
  it("retries a bounded number of times, then escalates", () => {
    expect(decideAfterFailure(1, "boom").decision).toBe("retry");
    expect(decideAfterFailure(MAX_ATTEMPTS, "boom").decision).toBe("escalate");
  });

  it("treats a completed idempotency key as already executed and dedupes on sync", () => {
    const row: ActionRecordRow = {
      id: "act1",
      agentRunId: null,
      planId: "plan1",
      taskId: "t1",
      actionType: "review",
      permissionClass: "READ",
      status: "completed",
      idempotencyKey: "key-t1",
      retryCount: 1,
      affectedEntityIds: [],
      expectedImpact: "",
      result: "done",
      error: null,
      validation: null,
      approvalRef: null,
      startedAt: iso(2),
      completedAt: iso(2),
      updatedAt: iso(2),
    };
    expect(alreadyExecuted([row], "key-t1")).toBe(true);
    expect(attemptsFor([row], "key-t1")).toBe(1);
    expect(dedupeByKey([row, { ...row, id: "act2" }]).length).toBe(1);
  });
});

describe("runtime", () => {
  it("executes a ready task through the registry only", async () => {
    const { services, calls } = servicesSpy();
    const task = makeTask({ id: "t1", stateHash: facts().stateHash });
    const verdict = await executeTask({
      task,
      tasks: [task],
      planId: "plan1",
      agentRunId: "run1",
      facts: facts(),
      blueprint: null,
      services,
      ledger: [],
      planApprovalId: "run1",
    });
    expect(verdict.kind).toBe("executed");
    expect(calls).toEqual([]);
    if (verdict.kind === "executed") expect(verdict.task.status).toBe("completed");
  });

  it("refuses high-impact work without its own approval", async () => {
    const { services } = servicesSpy();
    const task = makeTask({
      id: "t2",
      action: { type: "start_quest", questId: "q1" },
      stateHash: facts().stateHash,
    });
    const verdict = await executeTask({
      task,
      tasks: [task],
      planId: "plan1",
      agentRunId: "run1",
      facts: facts(),
      blueprint: null,
      services,
      ledger: [],
      planApprovalId: "run1",
    });
    expect(verdict.kind).toBe("needs_approval");
  });

  it("never repeats an action that already completed", async () => {
    const { services, calls } = servicesSpy();
    const task = makeTask({
      id: "t3",
      stateHash: facts().stateHash,
      action: {
        type: "create_quest",
        quest: {
          name: "Walk",
          description: "",
          durationMinutes: 10,
          difficulty: "easy",
          isRecovery: false,
        },
        startImmediately: false,
      },
    });
    const ledger: ActionRecordRow[] = [
      {
        id: "act9",
        agentRunId: "run1",
        planId: "plan1",
        taskId: task.id,
        actionType: "create_quest",
        permissionClass: "LOW_RISK_WRITE",
        status: "completed",
        idempotencyKey: task.idempotencyKey,
        retryCount: 0,
        affectedEntityIds: ["q1"],
        expectedImpact: "",
        result: "Created quest \"Walk\".",
        error: null,
        validation: null,
        approvalRef: "run1",
        startedAt: iso(1),
        completedAt: iso(1),
        updatedAt: iso(1),
      },
    ];
    const verdict = await executeTask({
      task,
      tasks: [task],
      planId: "plan1",
      agentRunId: "run1",
      facts: facts(),
      blueprint: null,
      services,
      ledger,
      planApprovalId: "run1",
    });
    expect(verdict.kind).toBe("already_done");
    expect(calls).toEqual([]);
  });

  it("blocks a task whose dependency has not finished", async () => {
    const { services } = servicesSpy();
    const first = makeTask({ id: "a" });
    const second = makeTask({ id: "b", dependencyIds: ["a"] });
    const verdict = await executeTask({
      task: second,
      tasks: [first, second],
      planId: "plan1",
      agentRunId: "run1",
      facts: facts(),
      blueprint: null,
      services,
      ledger: [],
      planApprovalId: "run1",
    });
    expect(verdict.kind).toBe("blocked");
  });

  it("records a failure and escalates after the retry budget", async () => {
    const { services } = servicesSpy({
      createQuest: async () => {
        throw new Error("engine refused");
      },
    });
    const task = makeTask({
      id: "t4",
      attempts: MAX_ATTEMPTS - 1,
      stateHash: facts().stateHash,
      action: {
        type: "create_quest",
        quest: {
          name: "Walk",
          description: "",
          durationMinutes: 10,
          difficulty: "easy",
          isRecovery: false,
        },
        startImmediately: false,
      },
    });
    const verdict = await executeTask({
      task,
      tasks: [task],
      planId: "plan1",
      agentRunId: "run1",
      facts: facts(),
      blueprint: null,
      services,
      ledger: [],
      planApprovalId: "run1",
    });
    expect(verdict.kind).toBe("failed");
    if (verdict.kind === "failed") {
      expect(verdict.escalated).toBe(true);
      expect(verdict.recovery).toBeTruthy();
    }
  });
});

describe("replanning and health", () => {
  const basePlan = (): PlanRecord => ({
    id: "plan1",
    agentRunId: "run1",
    signature: "sig",
    variant: "recommended",
    proposalGroupId: "grp",
    goalText: "Walk daily",
    title: "Walk daily",
    rationale: "",
    status: "active",
    confidence: 0.5,
    evidence: [],
    constraints: [],
    assumptions: [],
    tradeOffs: [],
    expectedImpact: "",
    milestones: [],
    horizonDays: 7,
    source: "engine",
    brain: null,
    validation: null,
    materialSnapshot: materialSnapshotOf(facts()),
    sourceRecommendationId: null,
    usedDriveContext: false,
    createdAt: iso(2),
    updatedAt: iso(2),
    approvedAt: iso(2),
    decidedAt: iso(2),
  });

  it("proposes a replan when a task fails", () => {
    const failed = makeTask({ id: "t1", status: "failed", lastError: "engine refused" });
    const verdict = assessReplan({ plan: basePlan(), tasks: [failed], facts: facts() });
    expect(verdict.needed).toBe(true);
    expect(verdict.reason).toBe("task_failed");
  });

  it("requires re-approval only when modification adds write work", () => {
    const write = makeTask({
      id: "w",
      action: {
        type: "create_quest",
        quest: {
          name: "Walk",
          description: "",
          durationMinutes: 10,
          difficulty: "easy",
          isRecovery: false,
        },
        startImmediately: false,
      },
    });
    const read = makeTask({ id: "r" });
    expect(modificationNeedsApproval([write, read], [read])).toBe(false);
    expect(modificationNeedsApproval([read], [read, write])).toBe(true);
  });

  it("counts agent health deterministically", () => {
    const tasks = [
      makeTask({ id: "a", status: "completed" }),
      makeTask({ id: "b", status: "failed" }),
    ];
    const health = buildAgentHealth({
      plans: [{ ...basePlan(), status: "completed" }],
      tasks,
      actions: [],
      outcomes: [],
    });
    expect(health.tasksCompleted).toBe(1);
    expect(health.tasksFailed).toBe(1);
    expect(health.successRate).toBe(0.5);

    const summary = summariseOutcome({ tasks, actions: [] });
    expect(summary.result).toBe("partial");
    expect(summary.metrics.tasksCompleted).toBe(1);
  });
});
