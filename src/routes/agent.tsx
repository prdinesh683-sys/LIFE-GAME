import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  ShieldAlert,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { EmptyState, Panel, Pill, SectionTitle, StatTile } from "@/components/app/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { EVIDENCE_KIND_LABELS, type EvidenceKind } from "@/lib/advisor/advisor-types";
import { PERMISSION_LABELS, type PlanRecord, type TaskRecord } from "@/lib/agent/agent-types";
import { useAgent } from "@/lib/services/agent-store";

export const Route = createFileRoute("/agent")({
  head: () => ({
    meta: [
      { title: "Plans — Life Game" },
      {
        name: "description",
        content:
          "Multi-step plans the agent proposes for your goals: every task, its dependencies, what it will change, and why. Nothing runs until you approve it.",
      },
      { property: "og:title", content: "Plans — Life Game" },
      {
        property: "og:description",
        content: "Review, modify and approve multi-step agent plans. You stay in control of every action.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentPage,
});

type Tab = "proposals" | "board" | "history" | "health";

type Tone = "accent" | "destructive" | "drain" | "muted" | "primary" | "spark";

const STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  awaiting_approval: "accent",
  approved: "primary",
  active: "primary",
  paused: "accent",
  needs_replan: "accent",
  completed: "spark",
  failed: "destructive",
  cancelled: "muted",
  blocked: "drain",
  ready: "primary",
  running: "primary",
  skipped: "muted",
};

function label(text: string): string {
  return text.replace(/_/g, " ");
}

function AgentPage() {
  const agent = useAgent();
  const [tab, setTab] = useState<Tab>("proposals");
  const [goal, setGoal] = useState("");
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PlanRecord | null>(null);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState<PlanRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const history = useMemo(
    () =>
      agent.plans.filter((p) =>
        ["completed", "failed", "cancelled"].includes(p.status),
      ),
    [agent.plans],
  );
  const live = useMemo(
    () => agent.plans.filter((p) => p.status === "active" || p.status === "approved" || p.status === "needs_replan"),
    [agent.plans],
  );

  async function submitGoal() {
    if (!goal.trim()) return;
    setBusy(true);
    await agent.propose(goal);
    setBusy(false);
    setGoal("");
    setTab("proposals");
  }

  async function approve(plan: PlanRecord) {
    setBusy(true);
    const result = await agent.approvePlan(plan.id);
    setBusy(false);
    if (result.ok) {
      toast.success("Plan approved — tasks are ready to run.");
      setTab("board");
    } else {
      toast.error(result.problems[0] ?? "This plan is no longer valid.");
    }
  }

  async function run(plan: PlanRecord, approveActionId?: string) {
    setBusy(true);
    const result = await agent.runNext(plan.id, approveActionId ? { approveActionId } : {});
    setBusy(false);
    for (const message of result.messages.slice(0, 3)) toast(message);
    if (result.stale) setTab("board");
  }

  return (
    <AppShell
      title="Plans 🤖"
      subtitle="Multi-step plans. The agent proposes; you approve; the game engine executes."
    >
      <div className="space-y-4">
        <Panel className="p-4">
          <SectionTitle>What do you want to achieve?</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe a goal. You get 2–3 validated plan alternatives — recommended, ambitious and
            conservative — with every step visible before anything happens.
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. Get back to running three times a week"
              aria-label="Goal for the agent"
            />
            <Button onClick={submitGoal} disabled={busy || agent.planning || !goal.trim()}>
              <Bot className="mr-1 h-4 w-4" />
              {agent.planning ? "Planning…" : "Plan it"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{agent.brainLabel}</p>
          {agent.note ? <p className="mt-1 text-xs text-amber-500">{agent.note}</p> : null}
        </Panel>

        {agent.directAction ? (
          <Panel glow className="space-y-2 p-4">
            <SectionTitle>No plan needed</SectionTitle>
            <p className="text-sm">{agent.directAction.summary}</p>
            <p className="text-xs text-muted-foreground">{agent.directAction.reason}</p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={async () => {
                  const result = await agent.applyDirectAction();
                  toast(result.message);
                }}
              >
                Do it
              </Button>
              <Button size="sm" variant="outline" onClick={() => agent.dismissDirectAction()}>
                Not now
              </Button>
            </div>
          </Panel>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {(["proposals", "board", "history", "health"] as Tab[]).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={tab === value ? "default" : "outline"}
              onClick={() => setTab(value)}
            >
              {label(value)}
            </Button>
          ))}
        </div>

        {tab === "proposals" ? (
          agent.proposals.length ? (
            <div className="space-y-3">
              {agent.proposals.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  tasks={agent.tasksFor(plan.id)}
                  expanded={openPlan === plan.id}
                  onToggle={() => setOpenPlan(openPlan === plan.id ? null : plan.id)}
                  actions={
                    <>
                      <Button size="sm" onClick={() => approve(plan)} disabled={busy}>
                        <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRejecting(plan);
                          setReason("");
                        }}
                      >
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </>
                  }
                  onReorder={(taskId, direction) => void agent.reorderTask(plan.id, taskId, direction)}
                  onSkip={(taskId) => void agent.skipTask(plan.id, taskId)}
                  onRemove={(taskId) => void agent.removeTask(plan.id, taskId)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No plan proposals"
              body="Describe a goal above and the agent will draft plan alternatives for you to review."
            />
          )
        ) : null}

        {tab === "board" ? (
          live.length ? (
            <div className="space-y-3">
              {live.map((plan) => {
                const replan = agent.replanFor(plan.id);
                const planTasks = agent.tasksFor(plan.id);
                const pending = planTasks.filter((t) => t.status === "awaiting_approval");
                return (
                  <div key={plan.id} className="space-y-2">
                    {replan?.needed ? (
                      <Panel className="p-3">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <AlertTriangle className="h-4 w-4 text-amber-500" /> Replan suggested
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{replan.detail}</p>
                        <Button
                          size="sm"
                          className="mt-2"
                          variant="outline"
                          onClick={() => void agent.replan(plan.id)}
                        >
                          <RefreshCw className="mr-1 h-4 w-4" /> Propose a new plan
                        </Button>
                      </Panel>
                    ) : null}
                    <PlanCard
                      plan={plan}
                      tasks={planTasks}
                      expanded
                      onToggle={() => undefined}
                      actions={
                        <>
                          <Button size="sm" onClick={() => run(plan)} disabled={busy}>
                            <Play className="mr-1 h-4 w-4" /> Run next
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void agent.cancelPlan(plan.id)}
                          >
                            Cancel plan
                          </Button>
                        </>
                      }
                      onReorder={(taskId, direction) => void agent.reorderTask(plan.id, taskId, direction)}
                      onSkip={(taskId) => void agent.skipTask(plan.id, taskId)}
                      onRemove={(taskId) => void agent.removeTask(plan.id, taskId)}
                      onApproveAction={(taskId) => void run(plan, taskId)}
                    />
                    {pending.length ? (
                      <p className="px-1 text-xs text-amber-500">
                        <ShieldAlert className="mr-1 inline h-3 w-3" />
                        {pending.length} high-impact task(s) need their own approval before running.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No active plan" body="Approve a proposal to see its task board here." />
          )
        ) : null}

        {tab === "history" ? (
          history.length ? (
            <div className="space-y-3">
              {history.map((plan) => {
                const outcome = agent.outcomes.find((o) => o.planId === plan.id);
                return (
                  <Panel key={plan.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-sm font-semibold">{plan.title}</p>
                        <p className="text-xs text-muted-foreground">{plan.goalText}</p>
                      </div>
                      <Pill tone={STATUS_TONE[plan.status] ?? "muted"}>{label(plan.status)}</Pill>
                    </div>
                    {outcome ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {outcome.note} · retries {outcome.metrics.retries}
                      </p>
                    ) : null}
                    <div className="mt-3 space-y-1">
                      {agent.actionsFor(plan.id).map((action) => (
                        <p key={action.id} className="text-xs text-muted-foreground">
                          {label(action.actionType)} — {label(action.status)}
                          {action.result ? ` · ${action.result}` : ""}
                          {action.error ? ` · ${action.error}` : ""}
                        </p>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void agent.giveFeedback(plan.id, null, "useful", "This plan helped.")}
                      >
                        Helpful
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void agent.giveFeedback(plan.id, null, "too_difficult", "This plan was too much.")
                        }
                      >
                        Too much
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(plan)}>
                        <Trash2 className="mr-1 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </Panel>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No finished plans yet" body="Completed and cancelled plans appear here." />
          )
        ) : null}

        {tab === "health" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile label="Plans" value={String(agent.health.plansTotal)} hint="proposed overall" />
            <StatTile label="Approved" value={`${Math.round(agent.health.approvalRate * 100)}%`} hint="of decided plans" />
            <StatTile label="Rejected" value={`${Math.round(agent.health.rejectionRate * 100)}%`} hint="of decided plans" />
            <StatTile
              label="Superseded"
              value={String(agent.health.plansSuperseded)}
              hint="alternatives replaced, not declined"
            />
            <StatTile label="Tasks done" value={String(agent.health.tasksCompleted)} hint={`${agent.health.tasksTotal} total`} />
            <StatTile
              label="Task success"
              value={`${Math.round(agent.health.successRate * 100)}%`}
              hint={`${agent.health.tasksFailed} failed`}
            />
            <StatTile label="Retries" value={String(agent.health.retries)} hint="bounded at 3 per action" />
            <StatTile label="Stalled" value={String(agent.health.tasksStalled)} hint="blocked or needing replan" />
            <StatTile label="Replans" value={String(agent.health.replans)} hint="plans needing rework" />
            <StatTile
              label="Outcome quality"
              value={agent.health.outcomeQuality == null ? "—" : `${Math.round(agent.health.outcomeQuality * 100)}%`}
              hint="measured after completion"
            />
          </div>
        ) : null}
      </div>

      <AlertDialog open={rejecting != null} onOpenChange={(open) => !open && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing has been executed. Telling the agent why helps it propose better plans later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this not right for you?"
            aria-label="Rejection reason"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejecting) void agent.rejectPlan(rejecting.id, reason);
                setRejecting(null);
              }}
            >
              Reject plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this plan and its history?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan, its tasks and its action records are removed permanently. Anything already
              completed in the game stays as it is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) void agent.deletePlan(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function PlanCard({
  plan,
  tasks,
  expanded,
  onToggle,
  actions,
  onReorder,
  onSkip,
  onRemove,
  onApproveAction,
}: {
  plan: PlanRecord;
  tasks: TaskRecord[];
  expanded: boolean;
  onToggle: () => void;
  actions: React.ReactNode;
  onReorder: (taskId: string, direction: -1 | 1) => void;
  onSkip: (taskId: string) => void;
  onRemove: (taskId: string) => void;
  onApproveAction?: (taskId: string) => void;
}) {
  const writeTasks = tasks.filter((t) => t.permissionClass !== "READ").length;
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-sm font-semibold">{plan.title}</p>
          <p className="text-xs text-muted-foreground">{plan.rationale}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Pill tone={STATUS_TONE[plan.status] ?? "muted"}>{label(plan.status)}</Pill>
          <Pill tone="muted">{plan.variant}</Pill>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> {tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0)} min over{" "}
          {plan.horizonDays} days
        </span>
        <span>Confidence {Math.round(plan.confidence * 100)}%</span>
        <span>
          {tasks.length} tasks · {writeTasks} change something
        </span>
        {plan.usedDriveContext ? <span>🗂️ Drive context used</span> : null}
      </div>

      {plan.expectedImpact ? (
        <p className="mt-2 text-sm">Expected: {plan.expectedImpact}</p>
      ) : null}
      {plan.tradeOffs.length ? (
        <p className="mt-1 text-sm text-muted-foreground">Trade-offs: {plan.tradeOffs.join(" · ")}</p>
      ) : null}
      {plan.assumptions.length ? (
        <p className="mt-1 text-sm text-muted-foreground">Assumptions: {plan.assumptions.join(" · ")}</p>
      ) : null}
      {plan.constraints.length ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Constraints: {plan.constraints.join(" · ")}
        </p>
      ) : null}
      {plan.evidence.length ? (
        <div className="mt-2 space-y-2 rounded-md border border-border/60 p-2 text-xs">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Why this plan?
          </p>
          {(["fact", "observation", "hypothesis"] as EvidenceKind[]).map((kind) => {
            const items = plan.evidence.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind}>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {kind === "hypothesis"
                    ? "Hypotheses (guesses, not facts)"
                    : `${EVIDENCE_KIND_LABELS[kind]}s`}
                </p>
                <ul
                  className={`mt-1 space-y-0.5 ${kind === "hypothesis" ? "text-muted-foreground" : ""}`}
                >
                  {items.map((item) => (
                    <li key={item.text}>• {item.text}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
      {plan.validation?.adjustments.length ? (
        <p className="mt-1 text-xs text-amber-500">{plan.validation.adjustments.join(" · ")}</p>
      ) : null}
      {plan.validation?.problems.length ? (
        <p className="mt-1 text-xs text-red-500">
          {plan.validation.problems.map((problem) => problem.message).join(" · ")}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {actions}
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {expanded ? "Hide steps" : "Show steps"}
        </Button>
      </div>

      {expanded ? (
        <ol className="mt-3 space-y-2">
          {tasks.map((task, index) => (
            <li key={task.id} className="rounded-md border border-border/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {index + 1}. {task.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{task.detail}</p>
                </div>
                <Pill tone={STATUS_TONE[task.status] ?? "muted"}>{label(task.status)}</Pill>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{PERMISSION_LABELS[task.permissionClass]}</span>
                <span>{task.estimatedMinutes} min</span>
                {task.dependencyIds.length ? <span>waits for {task.dependencyIds.length} step(s)</span> : null}
                {task.attempts ? <span>attempt {task.attempts}/3</span> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Will change: {label(task.action.type)}
              </p>
              {task.resultSummary ? <p className="mt-1 text-xs">{task.resultSummary}</p> : null}
              {task.lastError ? <p className="mt-1 text-xs text-red-500">{task.lastError}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => onReorder(task.id, -1)} aria-label="Move earlier">
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onReorder(task.id, 1)} aria-label="Move later">
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onSkip(task.id)}>
                  <SkipForward className="mr-1 h-3 w-3" /> Skip
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onRemove(task.id)}>
                  <Trash2 className="mr-1 h-3 w-3" /> Remove
                </Button>
                {onApproveAction && task.status === "awaiting_approval" ? (
                  <Button size="sm" onClick={() => onApproveAction(task.id)}>
                    Approve this action
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}
