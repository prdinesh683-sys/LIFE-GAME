import type { AdvisorFacts } from "../advisor/advisor-facts";
import { materialSnapshotOf } from "../advisor/advisor-feedback";
import { evidenceFromTrigger, resolveConfidence, scoreEvidence } from "../advisor/advisor-evidence";
import type { EvidenceItem } from "../advisor/advisor-types";
import type { GoalPlanResponse } from "../ai/schemas";
import { newId } from "../game/quest-engine";
import type { AttributeKey, Difficulty } from "../game/types";
import { permissionOf, idempotencyKeyFor } from "./action-registry";
import type {
  AgentAction,
  PlanMilestone,
  PlanRecord,
  PlanVariant,
  TaskRecord,
} from "./agent-types";

/**
 * PHASE 4C — planner.
 *
 * The AI proposes a plan through the existing Phase 2 router (the Phase 4A/4B
 * goal-plan job), and this module turns that proposal into a deterministic
 * goal → milestones → tasks → typed actions structure. With no brain
 * connected, the same deterministic decomposition runs on the local draft, so
 * planning degrades instead of failing.
 */

export interface PlanDraft {
  variant: PlanVariant;
  title: string;
  rationale: string;
  goalText: string;
  milestones: PlanMilestone[];
  tasks: {
    title: string;
    detail: string;
    milestoneId: string | null;
    order: number;
    dependsOnPrevious: boolean;
    action: AgentAction;
    estimatedMinutes: number;
  }[];
  constraints: string[];
  assumptions: string[];
  tradeOffs: string[];
  expectedImpact: string;
  horizonDays: number;
  confidence: number;
}

const DIFFICULTY_FOR_ENERGY = (energy: number | null): Difficulty => {
  if (energy == null) return "normal";
  if (energy <= 1) return "easy";
  if (energy <= 3) return "normal";
  return "hard";
};

function clampMinutes(minutes: number, facts: AdvisorFacts): number {
  const available = facts.availableMinutes;
  const capped = available != null && available > 0 ? Math.min(minutes, available) : minutes;
  return Math.max(5, Math.round(capped));
}

function questAction(
  name: string,
  description: string,
  minutes: number,
  facts: AdvisorFacts,
  startImmediately = false,
): AgentAction {
  return {
    type: "create_quest",
    quest: {
      name,
      description,
      durationMinutes: clampMinutes(minutes, facts),
      difficulty: DIFFICULTY_FOR_ENERGY(facts.energy),
      isRecovery: false,
    },
    startImmediately,
  };
}

/** Deterministic decomposition shared by every variant. */
function baseTasks(
  goalText: string,
  facts: AdvisorFacts,
  milestones: PlanMilestone[],
  quests: { name: string; minutes: number }[],
): PlanDraft["tasks"] {
  const tasks: PlanDraft["tasks"] = [
    {
      title: "Review current state",
      detail: `Check momentum (${facts.momentum}), open goals and today's window before committing.`,
      milestoneId: milestones[0]?.id ?? null,
      order: 0,
      dependsOnPrevious: false,
      action: { type: "review", note: `Reviewed state for: ${goalText}` },
      estimatedMinutes: 0,
    },
  ];
  quests.forEach((quest, index) => {
    tasks.push({
      title: quest.name,
      detail: `Concrete step toward: ${goalText}`,
      milestoneId: milestones[Math.min(index, milestones.length - 1)]?.id ?? null,
      order: index + 1,
      dependsOnPrevious: true,
      action: questAction(quest.name, `Step ${index + 1} of "${goalText}"`, quest.minutes, facts),
      estimatedMinutes: clampMinutes(quest.minutes, facts),
    });
  });
  return tasks;
}

function milestonesFrom(titles: string[], goalText: string): PlanMilestone[] {
  const list = titles.filter((t) => t.trim()).slice(0, 4);
  const source = list.length ? list : [`First real step toward ${goalText}`, "Keep the streak alive"];
  return source.map((title) => ({ id: newId("mls"), title: title.trim() }));
}

export interface PlannerInput {
  goalText: string;
  facts: AdvisorFacts;
  /** AI proposal from the existing goal-planning job, when a brain answered. */
  aiPlan: GoalPlanResponse | null;
}

/** Produces 2–3 independently validated alternatives. */
export function buildPlanDrafts(input: PlannerInput): PlanDraft[] {
  const { goalText, facts, aiPlan } = input;
  const titles = aiPlan?.milestones ?? [];
  const milestones = milestonesFrom(titles, goalText);

  const aiQuests = (aiPlan?.quests ?? [])
    .filter((q) => q.name?.trim())
    .slice(0, 4)
    .map((q) => ({ name: q.name.trim(), minutes: Math.max(5, Math.round(q.duration_minutes || 20)) }));

  const quests = aiQuests.length
    ? aiQuests
    : [
        { name: `Start ${goalText}`, minutes: 20 },
        { name: `Continue ${goalText}`, minutes: 30 },
        { name: `Consolidate ${goalText}`, minutes: 25 },
      ];

  const evidenceConfidence = Math.min(0.8, aiPlan?.confidence ?? 0.5);

  const recommended: PlanDraft = {
    variant: "recommended",
    title: aiPlan?.destination.title?.trim() || goalText,
    rationale:
      aiPlan?.schedule?.trim() ||
      `Broken into ${quests.length} steps that fit your current momentum (${facts.momentum}) and today's window.`,
    goalText,
    milestones,
    tasks: baseTasks(goalText, facts, milestones, quests),
    constraints: [
      facts.availableMinutes != null
        ? `About ${facts.availableMinutes} minutes available today.`
        : "No declared time window for today.",
      facts.hasActiveRun ? "A quest is already running." : "No quest is running right now.",
    ],
    assumptions: aiPlan?.hypotheses ?? ["Your recent pace continues."],
    tradeOffs: [
      "Takes the largest share of your time in exchange for the fastest visible progress.",
    ],
    expectedImpact:
      aiPlan?.boosts?.[0] ?? "Steady progress with one concrete step you can finish today.",
    horizonDays: Math.min(14, Math.max(1, (aiPlan?.destination.duration_weeks ?? 1) * 7)),
    confidence: evidenceConfidence,
  };

  const alternativeQuests = [...quests].reverse().slice(0, Math.max(2, quests.length - 1));
  const alternative: PlanDraft = {
    ...recommended,
    variant: "alternative",
    title: `${recommended.title} — different order`,
    rationale: "Same goal, front-loading the easier step so momentum builds before the hard part.",
    tasks: baseTasks(goalText, facts, milestones, alternativeQuests),
    tradeOffs: ["Slower start, but far less likely to stall on day one."],
    expectedImpact: "Lower risk of a miss, slightly slower progress.",
    confidence: Math.max(0.3, evidenceConfidence - 0.05),
  };

  const smallest = quests.reduce((a, b) => (a.minutes <= b.minutes ? a : b));
  const conservative: PlanDraft = {
    ...recommended,
    variant: "conservative",
    title: `${recommended.title} — minimum viable`,
    rationale: "One small step only, sized for a low-energy day.",
    tasks: baseTasks(goalText, facts, milestones.slice(0, 1), [
      { name: smallest.name, minutes: Math.min(15, smallest.minutes) },
    ]),
    tradeOffs: ["Barely moves the goal, but almost impossible to miss."],
    expectedImpact: "Protects the streak; minimal goal progress.",
    horizonDays: 1,
    confidence: Math.max(0.35, evidenceConfidence - 0.1),
  };

  return [recommended, alternative, conservative];
}

export interface MaterialisedPlan {
  plan: PlanRecord;
  tasks: TaskRecord[];
}

export function planSignature(goalText: string, variant: PlanVariant, stateHash: string): string {
  return `plan:${goalText.trim().toLowerCase().slice(0, 60)}:${variant}:${stateHash}`;
}

export function materialisePlan(input: {
  draft: PlanDraft;
  facts: AdvisorFacts;
  proposalGroupId: string;
  source: "ai" | "engine";
  brain: string | null;
  usedDriveContext: boolean;
  sourceRecommendationId?: string | null;
  evidence?: EvidenceItem[];
}): MaterialisedPlan {
  const now = new Date().toISOString();
  const planId = newId("plan");
  const evidence =
    input.evidence ??
    evidenceFromTrigger({
      facts: [
        `Momentum is ${input.facts.momentum}.`,
        `${input.facts.completions7d} completions and ${input.facts.misses7d} misses in the last 7 days.`,
      ],
      observations: input.facts.patterns.slice(0, 3),
      hypotheses: input.draft.assumptions.slice(0, 2),
    });
  // Confidence is deterministic: the draft may only claim what evidence allows.
  const evidenceScore = scoreEvidence(evidence, input.facts.finishedRuns);
  const confidence = resolveConfidence(input.draft.confidence, evidenceScore);

  const plan: PlanRecord = {
    id: planId,
    agentRunId: null,
    signature: planSignature(input.draft.goalText, input.draft.variant, input.facts.stateHash),
    variant: input.draft.variant,
    proposalGroupId: input.proposalGroupId,
    goalText: input.draft.goalText,
    title: input.draft.title,
    rationale: input.draft.rationale,
    status: "awaiting_approval",
    confidence,
    evidence,
    constraints: input.draft.constraints,
    assumptions: input.draft.assumptions,
    tradeOffs: input.draft.tradeOffs,
    expectedImpact: input.draft.expectedImpact,
    milestones: input.draft.milestones,
    horizonDays: input.draft.horizonDays,
    source: input.source,
    brain: input.brain,
    validation: null,
    materialSnapshot: materialSnapshotOf(input.facts),
    sourceRecommendationId: input.sourceRecommendationId ?? null,
    usedDriveContext: input.usedDriveContext,
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    decidedAt: null,
  };

  const ids = input.draft.tasks.map(() => newId("task"));
  const tasks: TaskRecord[] = input.draft.tasks.map((draft, index) => {
    const id = ids[index]!;
    const dependencyIds = draft.dependsOnPrevious && index > 0 ? [ids[index - 1]!] : [];
    return {
      id,
      planId,
      milestoneId: draft.milestoneId,
      title: draft.title,
      detail: draft.detail,
      order: draft.order,
      dependencyIds,
      status: "planned",
      action: draft.action,
      permissionClass: permissionOf(draft.action),
      estimatedMinutes: draft.estimatedMinutes,
      attempts: 0,
      lastError: null,
      approvalId: null,
      idempotencyKey: idempotencyKeyFor(planId, id, draft.action),
      stateHash: input.facts.stateHash,
      validation: null,
      resultSummary: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
  });

  return { plan, tasks };
}

/** Attribute helper kept local so the planner never guesses game economy. */
export const PLANNER_DEFAULT_ATTRIBUTE: AttributeKey = "focus";
