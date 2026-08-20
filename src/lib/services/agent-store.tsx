import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { aiGoalPlan } from "../ai/ai-service";
import { buildPersonalContext, layersForJob } from "../ai/personal-context-service";
import { readDriveContextForAi } from "../sync/drive-context-bridge";
import { buildAdvisorFacts, type AdvisorFacts } from "../advisor/advisor-facts";
import { materialSnapshotOf } from "../advisor/advisor-feedback";
import { newId } from "../game/quest-engine";
import type { ActionServices } from "../agent/action-registry";
import { needsIndividualApproval } from "../agent/action-registry";
import { dedupeByKey } from "../agent/action-ledger";
import { buildAgentHealth, summariseOutcome, type AgentHealthReport } from "../agent/agent-health";
import { executeTask, checkpointNote } from "../agent/agent-runtime";
import {
  canPlanTransition,
  type ActionRecordRow,
  type AgentFeedbackKind,
  type AgentFeedbackRecord,
  type AgentOutcomeRecord,
  type AgentRunRecord,
  type PlanRecord,
  type TaskRecord,
} from "../agent/agent-types";
import { blockedTasks, parallelBatch, readyTasks } from "../agent/dependency-graph";
import { buildPlanDrafts, materialisePlan } from "../agent/planner";
import { planStale, validatePlan } from "../agent/plan-validation";
import { assessReplan, modificationNeedsApproval, type ReplanVerdict } from "../agent/replanner";
import { rightSize, type RightSizeVerdict } from "../agent/right-size";
import { useAi } from "./ai-store";
import { useGame } from "./game-store";

/**
 * AGENT STORE — Phase 4C.
 *
 * Owns plans, tasks, action records and their approval lifecycle. It never
 * writes game state itself: execution goes through the typed action registry,
 * which calls the same deterministic game-store services the manual UI uses.
 */

/**
 * Right-sizing outcome: small goals never become plans. One or two independent
 * actions are handed straight to the direct (Advisor-style) path.
 */
export interface DirectActionSuggestion {
  goalText: string;
  reason: string;
  summary: string;
  action: TaskRecord["action"];
}

export interface RunResult {
  executed: number;
  messages: string[];
  needsApproval: TaskRecord[];
  stale: boolean;
}

interface AgentStoreValue {
  ready: boolean;
  facts: AdvisorFacts | null;
  plans: PlanRecord[];
  tasks: TaskRecord[];
  actions: ActionRecordRow[];
  runs: AgentRunRecord[];
  outcomes: AgentOutcomeRecord[];
  feedback: AgentFeedbackRecord[];
  planning: boolean;
  note: string | null;
  brainLabel: string;
  health: AgentHealthReport;
  activePlan: PlanRecord | null;
  proposals: PlanRecord[];
  tasksFor: (planId: string) => TaskRecord[];
  actionsFor: (planId: string) => ActionRecordRow[];
  readyFor: (planId: string) => TaskRecord[];
  blockedFor: (planId: string) => TaskRecord[];
  replanFor: (planId: string) => ReplanVerdict | null;
  propose: (goalText: string) => Promise<void>;
  /** Set when the goal is too small to deserve a plan. */
  directAction: DirectActionSuggestion | null;
  dismissDirectAction: () => void;
  applyDirectAction: () => Promise<{ ok: boolean; message: string }>;
  approvePlan: (planId: string) => Promise<{ ok: boolean; problems: string[] }>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  cancelPlan: (planId: string) => Promise<void>;
  runNext: (planId: string, options?: { approveActionId?: string }) => Promise<RunResult>;
  reorderTask: (planId: string, taskId: string, direction: -1 | 1) => Promise<void>;
  skipTask: (planId: string, taskId: string) => Promise<void>;
  removeTask: (planId: string, taskId: string) => Promise<void>;
  replan: (planId: string) => Promise<void>;
  giveFeedback: (planId: string, taskId: string | null, kind: AgentFeedbackKind, note: string) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
}

const AgentContext = createContext<AgentStoreValue | null>(null);

const EMPTY_HEALTH = buildAgentHealth({ plans: [], tasks: [], actions: [], outcomes: [] });

export function AgentStoreProvider({ children }: { children: ReactNode }) {
  const game = useGame();
  const ai = useAi();
  const { repository, router, snapshot, momentum } = game;

  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [actions, setActions] = useState<ActionRecordRow[]>([]);
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [outcomes, setOutcomes] = useState<AgentOutcomeRecord[]>([]);
  const [feedback, setFeedback] = useState<AgentFeedbackRecord[]>([]);
  const [planning, setPlanning] = useState(false);
  const [directAction, setDirectAction] = useState<DirectActionSuggestion | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    void (async () => {
      const [p, t, a, r, o, f] = await Promise.all([
        repository.list("plans"),
        repository.list("tasks"),
        repository.list("actionRecords"),
        repository.list("agentRuns"),
        repository.list("agentOutcomes"),
        repository.list("agentFeedback"),
      ]);
      if (cancelled) return;
      setPlans([...p].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt)));
      setTasks(t);
      // Cross-device convergence: one completed action per idempotency key.
      setActions(dedupeByKey(a));
      setRuns(r);
      setOutcomes(o);
      setFeedback(f);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const facts = useMemo(
    () => (snapshot ? buildAdvisorFacts(snapshot, momentum.value) : null),
    [snapshot, momentum.value],
  );

  const savePlan = useCallback(
    async (plan: PlanRecord) => {
      if (!repository) return;
      const stamped = { ...plan, updatedAt: new Date().toISOString() };
      await repository.put("plans", stamped);
      setPlans((prev) => [stamped, ...prev.filter((p) => p.id !== stamped.id)]);
      return stamped;
    },
    [repository],
  );

  const saveTasks = useCallback(
    async (rows: TaskRecord[]) => {
      if (!repository || !rows.length) return;
      const stamped = rows.map((row) => ({ ...row, updatedAt: new Date().toISOString() }));
      await repository.putMany("tasks", stamped);
      setTasks((prev) => {
        const ids = new Set(stamped.map((r) => r.id));
        return [...prev.filter((t) => !ids.has(t.id)), ...stamped];
      });
    },
    [repository],
  );

  const saveAction = useCallback(
    async (row: ActionRecordRow) => {
      if (!repository) return;
      await repository.put("actionRecords", row);
      setActions((prev) => dedupeByKey([...prev.filter((a) => a.id !== row.id), row]));
    },
    [repository],
  );

  const tasksFor = useCallback(
    (planId: string) => tasks.filter((t) => t.planId === planId).sort((a, b) => a.order - b.order),
    [tasks],
  );
  const actionsFor = useCallback(
    (planId: string) =>
      actions
        .filter((a) => a.planId === planId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    [actions],
  );

  const proposals = useMemo(
    () => plans.filter((p) => p.status === "awaiting_approval" || p.status === "needs_replan"),
    [plans],
  );
  const activePlan = useMemo(
    () => plans.find((p) => p.status === "active" || p.status === "approved") ?? null,
    [plans],
  );

  const health = useMemo(
    () => (ready ? buildAgentHealth({ plans, tasks, actions, outcomes }) : EMPTY_HEALTH),
    [ready, plans, tasks, actions, outcomes],
  );

  /** Deterministic services the registry is allowed to call. */
  const services = useMemo<ActionServices>(
    () => ({
      createQuest: game.createQuest,
      startQuest: (questId: string) => game.startQuest(questId),
      saveBoost: game.saveBoost,
      saveDestination: game.saveDestination,
      addMemory: (kind, text) => ai.addMemory(kind, text),
    }),
    [ai, game],
  );

  const propose = useCallback(
    async (goalText: string) => {
      if (!snapshot || !facts || planning || !goalText.trim()) return;
      setPlanning(true);
      setNote(null);
      try {
        // Minimum-context rule: cloud brains get the redacted layer set only.
        const minimal = router?.activeBrain("planning")?.id === "cloud";
        const vault = minimal ? null : readDriveContextForAi();
        const context = buildPersonalContext(snapshot, momentum.value, {
          layers: layersForJob("planning"),
          memories: ai.memories,
          minimal,
          vault,
        });
        const outcome = await aiGoalPlan(router, context, goalText.trim());
        const drafts = buildPlanDrafts({
          goalText: goalText.trim(),
          facts,
          aiPlan: outcome.source === "ai" ? outcome.value : null,
        });
        const groupId = newId("grp");
        const live = plans
          .filter((p) => p.status === "awaiting_approval" || p.status === "active")
          .map((p) => p.signature);

        setDirectAction(null);
        let created = 0;
        let rightSizeVerdict: RightSizeVerdict | null = null;
        for (const draft of drafts) {
          const materialised = materialisePlan({
            draft,
            facts,
            proposalGroupId: groupId,
            source: outcome.source === "ai" ? "ai" : "engine",
            brain: outcome.source === "ai" ? outcome.brain : null,
            usedDriveContext: Boolean(vault && vault.length > 0),
          });
          const validated = validatePlan({
            plan: materialised.plan,
            tasks: materialised.tasks,
            facts,
            blueprint: snapshot.blueprint,
            existingSignatures: live,
          });
          // Every alternative must pass deterministic validation on its own.
          if (!validated.report.ok) continue;
          // Right-sizing: a plan exists only when the work genuinely needs
          // sequencing. The first (recommended) valid alternative decides.
          if (!rightSizeVerdict) {
            rightSizeVerdict = rightSize(validated.tasks);
            if (rightSizeVerdict.shape === "direct_action") {
              const write = validated.tasks.find((t) => t.permissionClass !== "READ");
              if (write) {
                setDirectAction({
                  goalText: goalText.trim(),
                  reason: rightSizeVerdict.reason,
                  summary: write.title,
                  action: write.action,
                });
              }
              break;
            }
          }
          const plan = { ...materialised.plan, validation: validated.report };
          await savePlan(plan);
          await saveTasks(validated.tasks);
          live.push(plan.signature);
          created += 1;
        }
        if (rightSizeVerdict?.shape === "direct_action") {
          setNote(rightSizeVerdict.reason);
        } else if (!created) {
          setNote("No plan passed deterministic feasibility right now — try a smaller goal or free up time.");
        } else if (outcome.note) {
          setNote(outcome.note);
        }
      } finally {
        setPlanning(false);
      }
    },
    [ai.memories, facts, momentum.value, planning, plans, router, savePlan, saveTasks, snapshot],
  );

  const dismissDirectAction = useCallback(() => setDirectAction(null), []);

  /**
   * Small goals reuse the existing deterministic direct path — the same
   * game-store services the manual UI and the Advisor use. Nothing that takes
   * over your time starts by itself: starting a quest stays a separate tap.
   */
  const applyDirectAction = useCallback(async () => {
    if (!directAction) return { ok: false, message: "Nothing to do." };
    const action = directAction.action;
    if (action.type !== "create_quest") {
      setDirectAction(null);
      return { ok: true, message: "Noted — this one is guidance, nothing was changed." };
    }
    await services.createQuest({
      name: action.quest.name,
      description: action.quest.description,
      durationMinutes: action.quest.durationMinutes,
      difficulty: action.quest.difficulty,
      isRecovery: action.quest.isRecovery,
      createdBy: "engine",
      aiGenerated: false,
    });
    setDirectAction(null);
    return { ok: true, message: "Added to your quests. Start it when you're ready." };
  }, [directAction, services]);

  const approvePlan = useCallback(
    async (planId: string) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan || !facts || !snapshot) return { ok: false, problems: ["Plan not found."] };
      if (!canPlanTransition(plan.status, "approved")) {
        return { ok: false, problems: ["This plan can no longer be approved."] };
      }
      // Approval always revalidates against fresh state.
      const planTasks = tasksFor(planId);
      const validated = validatePlan({
        plan,
        tasks: planTasks,
        facts,
        blueprint: snapshot.blueprint,
      });
      if (!validated.report.ok) {
        await savePlan({
          ...plan,
          status: "needs_replan",
          validation: validated.report,
          materialSnapshot: materialSnapshotOf(facts),
        });
        await saveTasks(validated.tasks.map((t) => ({ ...t, status: "needs_replan" as const })));
        return { ok: false, problems: validated.report.problems.map((p) => p.message) };
      }

      const run: AgentRunRecord = {
        id: newId("run"),
        planId,
        status: "running",
        startedAt: new Date().toISOString(),
        endedAt: null,
        checkpoints: [{ at: new Date().toISOString(), note: "Plan approved and revalidated." }],
        updatedAt: new Date().toISOString(),
      };
      if (repository) await repository.put("agentRuns", run);
      setRuns((prev) => [run, ...prev]);

      await savePlan({
        ...plan,
        status: "approved",
        agentRunId: run.id,
        validation: validated.report,
        materialSnapshot: materialSnapshotOf(facts),
        approvedAt: new Date().toISOString(),
        decidedAt: new Date().toISOString(),
      });
      await saveTasks(
        validated.tasks.map((task) => ({
          ...task,
          status: needsIndividualApproval(task.action) ? ("awaiting_approval" as const) : ("ready" as const),
          approvalId: needsIndividualApproval(task.action) ? null : run.id,
        })),
      );
      // Sibling alternatives are superseded, never left dangling.
      for (const sibling of plans.filter(
        (p) => p.proposalGroupId === plan.proposalGroupId && p.id !== plan.id && p.status === "awaiting_approval",
      )) {
        await savePlan({
          ...sibling,
          status: "cancelled",
          closeReason: "superseded",
          decidedAt: new Date().toISOString(),
        });
      }
      await ai.addMemory("APPROVED_DECISION", `You approved the plan: ${plan.title}`);
      return { ok: true, problems: [] };
    },
    [ai, facts, plans, repository, savePlan, saveTasks, snapshot, tasksFor],
  );

  const rejectPlan = useCallback(
    async (planId: string, reason = "") => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;
      await savePlan({
        ...plan,
        status: "cancelled",
        closeReason: "rejected",
        decidedAt: new Date().toISOString(),
      });
      await saveTasks(tasksFor(planId).map((t) => ({ ...t, status: "cancelled" as const })));
      if (reason.trim()) {
        await ai.addMemory("USER_PREFERENCE", `You declined the plan "${plan.title}": ${reason.trim()}`);
      }
    },
    [ai, plans, savePlan, saveTasks, tasksFor],
  );

  const cancelPlan = useCallback(
    async (planId: string) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;
      await savePlan({
        ...plan,
        status: "cancelled",
        closeReason: "cancelled",
        decidedAt: new Date().toISOString(),
      });
      // Completed work is never silently reversed — there is no deterministic
      // inverse for it, so it stays completed and visible in history.
      await saveTasks(
        tasksFor(planId)
          .filter((t) => t.status !== "completed")
          .map((t) => ({ ...t, status: "cancelled" as const })),
      );
    },
    [plans, savePlan, saveTasks, tasksFor],
  );

  const recordOutcomeIfDone = useCallback(
    async (plan: PlanRecord, planTasks: TaskRecord[]) => {
      const open = planTasks.filter(
        (t) => t.status !== "completed" && t.status !== "skipped" && t.status !== "cancelled",
      );
      if (open.length) return;
      const summary = summariseOutcome({ tasks: planTasks, actions: actionsFor(plan.id) });
      const outcome: AgentOutcomeRecord = {
        id: newId("aout"),
        planId: plan.id,
        agentRunId: plan.agentRunId,
        measuredAt: new Date().toISOString(),
        ...summary,
      };
      if (repository) await repository.put("agentOutcomes", outcome);
      setOutcomes((prev) => [outcome, ...prev.filter((o) => o.planId !== plan.id)]);
      await savePlan({ ...plan, status: summary.result === "failed" ? "failed" : "completed" });
      await ai.addMemory(
        "APPROVED_DECISION",
        `Plan "${plan.title}" finished: ${summary.note}`,
      );
    },
    [actionsFor, ai, repository, savePlan],
  );

  const runNext = useCallback(
    async (planId: string, options: { approveActionId?: string } = {}): Promise<RunResult> => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan || !facts || !snapshot) {
        return { executed: 0, messages: ["Plan not found."], needsApproval: [], stale: false };
      }
      if (plan.status !== "approved" && plan.status !== "active") {
        return { executed: 0, messages: ["Approve the plan first."], needsApproval: [], stale: false };
      }
      if (planStale(plan, facts)) {
        const planTasks = tasksFor(planId);
        const validated = validatePlan({ plan, tasks: planTasks, facts, blueprint: snapshot.blueprint });
        if (!validated.report.ok) {
          await savePlan({ ...plan, status: "needs_replan", validation: validated.report });
          await saveTasks(validated.tasks.map((t) => ({ ...t, status: "needs_replan" as const })));
          return {
            executed: 0,
            messages: ["Your state changed and the plan no longer fits — it needs replanning."],
            needsApproval: [],
            stale: true,
          };
        }
        await savePlan({ ...plan, validation: validated.report, materialSnapshot: materialSnapshotOf(facts) });
        await saveTasks(validated.tasks);
      }

      const current = tasksFor(planId);
      const readyBatch = parallelBatch(current);
      // A task the user just approved individually is gated out of the ready set
      // (it sits in `awaiting_approval`), so add it back explicitly.
      const approvedTask = options.approveActionId
        ? current.find((t) => t.id === options.approveActionId && t.status === "awaiting_approval")
        : undefined;
      const batch =
        approvedTask && !readyBatch.some((t) => t.id === approvedTask.id)
          ? [approvedTask, ...readyBatch]
          : readyBatch;
      const messages: string[] = [];
      const needsApproval: TaskRecord[] = [];
      let executed = 0;
      let ledger = actions;
      let working = current;

      for (const task of batch) {
        const verdict = await executeTask({
          task,
          tasks: working,
          planId,
          agentRunId: plan.agentRunId,
          facts,
          blueprint: snapshot.blueprint,
          services,
          ledger,
          actionApprovalId:
            options.approveActionId === task.id ? `approval:${task.id}:${Date.now()}` : null,
          planApprovalId: plan.approvedAt ? plan.agentRunId : null,
        });
        working = working.map((t) => (t.id === verdict.task.id ? verdict.task : t));
        await saveTasks([verdict.task]);
        if (verdict.kind === "executed" || verdict.kind === "already_done") {
          await saveAction(verdict.action);
          ledger = [...ledger, verdict.action];
          executed += verdict.kind === "executed" ? 1 : 0;
          messages.push(verdict.summary);
        } else if (verdict.kind === "failed") {
          await saveAction(verdict.action);
          ledger = [...ledger, verdict.action];
          messages.push(verdict.escalated ? (verdict.recovery ?? verdict.error) : verdict.error);
        } else if (verdict.kind === "needs_approval") {
          needsApproval.push(verdict.task);
          messages.push(verdict.reason);
        } else {
          messages.push(verdict.reason);
        }
      }

      const remaining = working.filter(
        (t) => t.status !== "completed" && t.status !== "skipped" && t.status !== "cancelled",
      ).length;
      const updatedPlan: PlanRecord = { ...plan, status: plan.status === "approved" ? "active" : plan.status };
      await savePlan(updatedPlan);
      if (plan.agentRunId && repository) {
        const run = runs.find((r) => r.id === plan.agentRunId);
        if (run) {
          const next: AgentRunRecord = {
            ...run,
            checkpoints: [
              ...run.checkpoints,
              { at: new Date().toISOString(), note: checkpointNote(executed, remaining) },
            ],
            updatedAt: new Date().toISOString(),
          };
          await repository.put("agentRuns", next);
          setRuns((prev) => [next, ...prev.filter((r) => r.id !== next.id)]);
        }
      }
      await recordOutcomeIfDone(updatedPlan, working);
      if (!batch.length) messages.push("Nothing is ready to run — check blocked or approval-pending tasks.");
      return { executed, messages, needsApproval, stale: false };
    },
    [
      actions,
      facts,
      plans,
      recordOutcomeIfDone,
      repository,
      runs,
      saveAction,
      savePlan,
      saveTasks,
      services,
      snapshot,
      tasksFor,
    ],
  );

  const revalidateAfterModification = useCallback(
    async (planId: string, before: TaskRecord[], after: TaskRecord[]) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan || !facts || !snapshot) return;
      const validated = validatePlan({ plan, tasks: after, facts, blueprint: snapshot.blueprint });
      const needsApproval = modificationNeedsApproval(before, after);
      await saveTasks(validated.tasks);
      await savePlan({
        ...plan,
        validation: validated.report,
        status: !validated.report.ok
          ? "needs_replan"
          : needsApproval
            ? "awaiting_approval"
            : plan.status,
        approvedAt: needsApproval ? null : plan.approvedAt,
      });
    },
    [facts, plans, savePlan, saveTasks, snapshot],
  );

  const reorderTask = useCallback(
    async (planId: string, taskId: string, direction: -1 | 1) => {
      const before = tasksFor(planId);
      const index = before.findIndex((t) => t.id === taskId);
      const swapWith = index + direction;
      if (index < 0 || swapWith < 0 || swapWith >= before.length) return;
      const a = before[index]!;
      const b = before[swapWith]!;
      // Reordering may not break the dependency graph.
      if (a.dependencyIds.includes(b.id) || b.dependencyIds.includes(a.id)) return;
      const after = before.map((t) =>
        t.id === a.id ? { ...t, order: b.order } : t.id === b.id ? { ...t, order: a.order } : t,
      );
      await revalidateAfterModification(planId, before, after);
    },
    [revalidateAfterModification, tasksFor],
  );

  const skipTask = useCallback(
    async (planId: string, taskId: string) => {
      const before = tasksFor(planId);
      const after = before.map((t) => (t.id === taskId ? { ...t, status: "skipped" as const } : t));
      await revalidateAfterModification(planId, before, after);
    },
    [revalidateAfterModification, tasksFor],
  );

  const removeTask = useCallback(
    async (planId: string, taskId: string) => {
      const before = tasksFor(planId);
      const after = before
        .filter((t) => t.id !== taskId)
        .map((t) => ({ ...t, dependencyIds: t.dependencyIds.filter((id) => id !== taskId) }));
      if (repository) await repository.remove("tasks", taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      await revalidateAfterModification(planId, before, after);
    },
    [repository, revalidateAfterModification, tasksFor],
  );

  const replanFor = useCallback(
    (planId: string): ReplanVerdict | null => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan || !facts) return null;
      if (plan.status !== "active" && plan.status !== "approved") return null;
      return assessReplan({ plan, tasks: tasksFor(planId), facts });
    },
    [facts, plans, tasksFor],
  );

  const replan = useCallback(
    async (planId: string) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;
      await savePlan({ ...plan, status: "needs_replan" });
      await propose(plan.goalText);
    },
    [plans, propose, savePlan],
  );

  const giveFeedback = useCallback(
    async (planId: string, taskId: string | null, kind: AgentFeedbackKind, text: string) => {
      if (!repository) return;
      const row: AgentFeedbackRecord = {
        id: newId("afb"),
        planId,
        taskId,
        kind,
        note: text,
        createdAt: new Date().toISOString(),
      };
      await repository.put("agentFeedback", row);
      setFeedback((prev) => [row, ...prev]);
      // Feedback becomes long-term learning through the Phase 4B memory layer.
      await ai.addMemory("USER_PREFERENCE", `Plan feedback (${kind}): ${text || kind}`);
    },
    [ai, repository],
  );

  const deletePlan = useCallback(
    async (planId: string) => {
      if (!repository) return;
      for (const task of tasksFor(planId)) await repository.remove("tasks", task.id);
      for (const action of actionsFor(planId)) await repository.remove("actionRecords", action.id);
      await repository.remove("plans", planId);
      setTasks((prev) => prev.filter((t) => t.planId !== planId));
      setActions((prev) => prev.filter((a) => a.planId !== planId));
      setPlans((prev) => prev.filter((p) => p.id !== planId));
    },
    [actionsFor, repository, tasksFor],
  );

  const value = useMemo<AgentStoreValue>(
    () => ({
      ready,
      facts,
      plans,
      tasks,
      actions,
      runs,
      outcomes,
      feedback,
      planning,
      note,
      brainLabel: router?.activeBrainLabel("planning") ?? "Local game intelligence — no AI connected",
      health,
      activePlan,
      proposals,
      tasksFor,
      actionsFor,
      readyFor: (planId) => readyTasks(tasksFor(planId)),
      blockedFor: (planId) => blockedTasks(tasksFor(planId)),
      replanFor,
      propose,
      directAction,
      dismissDirectAction,
      applyDirectAction,
      approvePlan,
      rejectPlan,
      cancelPlan,
      runNext,
      reorderTask,
      skipTask,
      removeTask,
      replan,
      giveFeedback,
      deletePlan,
    }),
    [
      actions,
      actionsFor,
      activePlan,
      applyDirectAction,
      approvePlan,
      directAction,
      dismissDirectAction,
      cancelPlan,
      deletePlan,
      facts,
      feedback,
      giveFeedback,
      health,
      note,
      outcomes,
      planning,
      plans,
      proposals,
      propose,
      ready,
      rejectPlan,
      removeTask,
      reorderTask,
      replan,
      replanFor,
      router,
      runNext,
      runs,
      skipTask,
      tasks,
      tasksFor,
    ],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentStoreValue {
  const value = useContext(AgentContext);
  if (!value) throw new Error("useAgent must be used inside AgentStoreProvider");
  return value;
}
