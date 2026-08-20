import { z } from "zod";

import { validateRecommendation } from "../advisor/advisor-validation";
import type { AdvisorFacts } from "../advisor/advisor-facts";
import type { RecommendationAction, ValidationReport } from "../advisor/advisor-types";
import type { AttributeKey, Boost, Destination, PersonalBlueprint, Quest, QuestRun } from "../game/types";
import { newId } from "../game/quest-engine";
import type { QuestDraft } from "../game/quest-engine";
import type { AgentAction, PermissionClass } from "./agent-types";

/**
 * PHASE 4C — typed action registry.
 *
 * This is the ONLY legal dispatch path for agent actions. The agent may name an
 * action type; it can never name a handler, touch the repository or write React
 * state. Every action carries a schema, a deterministic validator, a permission
 * class, an idempotency key and its affected entities.
 */

/** Deterministic application services the agent is allowed to call. */
export interface ActionServices {
  createQuest: (draft: QuestDraft) => Promise<Quest>;
  startQuest: (questId: string) => Promise<QuestRun>;
  saveBoost: (boost: Boost) => Promise<void>;
  saveDestination: (destination: Destination) => Promise<void>;
  addMemory: (kind: "APPROVED_DECISION" | "USER_PREFERENCE", text: string) => Promise<void>;
}

export interface ActionContext {
  facts: AdvisorFacts;
  blueprint: PersonalBlueprint | null;
}

export interface ActionExecution {
  summary: string;
  affectedEntityIds: string[];
}

export interface ActionValidation {
  report: ValidationReport;
  /** Deterministically adjusted action actually approved for execution. */
  action: AgentAction;
}

export interface ActionDefinition {
  actionType: AgentAction["type"];
  permissionClass: PermissionClass;
  schema: z.ZodTypeAny;
  label: string;
  expectedImpact: (action: AgentAction) => string;
  affectedEntities: (action: AgentAction) => string[];
  validate: (action: AgentAction, context: ActionContext) => ActionValidation;
  execute: (action: AgentAction, services: ActionServices) => Promise<ActionExecution>;
  /** Present only where a real deterministic inverse exists. */
  rollback?: (result: ActionExecution, services: ActionServices) => Promise<void>;
  /** Equivalent low-risk actions may share one approval. */
  batchable: boolean;
}

const difficulty = z.enum(["trivial", "easy", "normal", "hard", "extreme"]);

const questSchema = z.object({
  type: z.literal("create_quest"),
  quest: z.object({
    name: z.string(),
    description: z.string(),
    durationMinutes: z.number(),
    difficulty,
    isRecovery: z.boolean(),
  }),
  startImmediately: z.boolean(),
});

const boostSchema = z.object({
  type: z.literal("create_boost"),
  boost: z.object({
    name: z.string(),
    category: z.string(),
    durationMinutes: z.number(),
    difficulty,
    frequency: z.string(),
    preferredTime: z.string(),
    attribute: z.string(),
  }),
});

const destinationSchema = z.object({
  type: z.literal("create_destination"),
  destination: z.object({
    title: z.string(),
    description: z.string(),
    priority: z.number(),
    attributes: z.array(z.string()),
  }),
});

const memorySchema = z.object({
  type: z.literal("add_memory"),
  memory: z.object({ text: z.string() }),
});

const reviewSchema = z.object({ type: z.literal("review"), note: z.string() });
const startQuestSchema = z.object({ type: z.literal("start_quest"), questId: z.string() });
const noneSchema = z.object({ type: z.literal("none") });

function okReport(facts: AdvisorFacts): ValidationReport {
  return {
    ok: true,
    problems: [],
    adjustments: [],
    validatedAt: new Date().toISOString(),
    stateHash: facts.stateHash,
  };
}

function blockedReport(facts: AdvisorFacts, code: string, message: string): ValidationReport {
  return {
    ok: false,
    problems: [{ code, message, severity: "block" }],
    adjustments: [],
    validatedAt: new Date().toISOString(),
    stateHash: facts.stateHash,
  };
}

/** Reuses the Phase 4A deterministic validator for the shared action shapes. */
function delegateValidate(action: RecommendationAction, context: ActionContext): ActionValidation {
  const result = validateRecommendation({
    action,
    facts: context.facts,
    blueprint: context.blueprint,
  });
  return { report: result.report, action: result.action };
}

const DEFINITIONS: ActionDefinition[] = [
  {
    actionType: "review",
    permissionClass: "READ",
    schema: reviewSchema,
    label: "Review progress",
    batchable: true,
    expectedImpact: () => "Reads state only — nothing changes.",
    affectedEntities: () => [],
    validate: (_action, context) => ({ report: okReport(context.facts), action: _action }),
    execute: async (action) => ({
      summary: action.type === "review" ? action.note || "Reviewed current state." : "Reviewed.",
      affectedEntityIds: [],
    }),
  },
  {
    actionType: "none",
    permissionClass: "READ",
    schema: noneSchema,
    label: "Guidance only",
    batchable: true,
    expectedImpact: () => "Guidance only — nothing changes.",
    affectedEntities: () => [],
    validate: (action, context) => ({ report: okReport(context.facts), action }),
    execute: async () => ({ summary: "Noted as guidance.", affectedEntityIds: [] }),
  },
  {
    actionType: "create_quest",
    permissionClass: "LOW_RISK_WRITE",
    schema: questSchema,
    label: "Create a quest",
    batchable: true,
    expectedImpact: (action) =>
      action.type === "create_quest"
        ? `Creates "${action.quest.name}" (${action.quest.durationMinutes} min).`
        : "",
    affectedEntities: () => ["quests"],
    validate: (action, context) => delegateValidate(action as RecommendationAction, context),
    execute: async (action, services) => {
      if (action.type !== "create_quest") throw new Error("Wrong action type.");
      const quest = await services.createQuest({
        name: action.quest.name,
        description: action.quest.description,
        durationMinutes: action.quest.durationMinutes,
        difficulty: action.quest.difficulty,
        isRecovery: action.quest.isRecovery,
        createdBy: "ai",
        aiGenerated: true,
      });
      if (action.startImmediately) await services.startQuest(quest.id);
      return { summary: `Created quest "${quest.name}".`, affectedEntityIds: [quest.id] };
    },
  },
  {
    actionType: "create_boost",
    permissionClass: "LOW_RISK_WRITE",
    schema: boostSchema,
    label: "Create a routine (Boost)",
    batchable: true,
    expectedImpact: (action) =>
      action.type === "create_boost" ? `Adds the routine "${action.boost.name}".` : "",
    affectedEntities: () => ["boosts"],
    validate: (action, context) => delegateValidate(action as RecommendationAction, context),
    execute: async (action, services) => {
      if (action.type !== "create_boost") throw new Error("Wrong action type.");
      const boost: Boost = {
        id: newId("boost"),
        name: action.boost.name,
        icon: "⚡",
        category: action.boost.category,
        difficulty: action.boost.difficulty,
        durationMinutes: action.boost.durationMinutes,
        frequency: action.boost.frequency,
        sparkReward: 0,
        attribute: action.boost.attribute,
        preferredTime: action.boost.preferredTime,
        minimumVersion: `${Math.max(5, Math.round(action.boost.durationMinutes / 3))} min version`,
        replacesDrainId: null,
        destinationId: null,
        createdAt: new Date().toISOString(),
      };
      await services.saveBoost(boost);
      return { summary: `Created routine "${boost.name}".`, affectedEntityIds: [boost.id] };
    },
  },
  {
    actionType: "add_memory",
    permissionClass: "LOW_RISK_WRITE",
    schema: memorySchema,
    label: "Save a decision to memory",
    batchable: true,
    expectedImpact: () => "Stores one decision in memory.",
    affectedEntities: () => ["memories"],
    validate: (action, context) => delegateValidate(action as RecommendationAction, context),
    execute: async (action, services) => {
      if (action.type !== "add_memory") throw new Error("Wrong action type.");
      await services.addMemory("APPROVED_DECISION", action.memory.text);
      return { summary: "Saved to memory.", affectedEntityIds: ["memories"] };
    },
  },
  {
    actionType: "create_destination",
    // A new goal changes priorities across the whole system.
    permissionClass: "HIGH_IMPACT",
    schema: destinationSchema,
    label: "Create a goal (Destination)",
    batchable: false,
    expectedImpact: (action) =>
      action.type === "create_destination"
        ? `Adds the goal "${action.destination.title}" at priority ${action.destination.priority}.`
        : "",
    affectedEntities: () => ["destinations"],
    validate: (action, context) => delegateValidate(action as RecommendationAction, context),
    execute: async (action, services) => {
      if (action.type !== "create_destination") throw new Error("Wrong action type.");
      const destination: Destination = {
        id: newId("dest"),
        title: action.destination.title,
        description: action.destination.description,
        priority: action.destination.priority,
        attributes: action.destination.attributes as AttributeKey[],
        progress: 0,
        status: "active",
        isBoss: false,
        bossMaxHp: 0,
        bossHp: 0,
        createdAt: new Date().toISOString(),
      };
      await services.saveDestination(destination);
      return { summary: `Created goal "${destination.title}".`, affectedEntityIds: [destination.id] };
    },
  },
  {
    actionType: "start_quest",
    // Starting a run occupies the player's attention right now.
    permissionClass: "HIGH_IMPACT",
    schema: startQuestSchema,
    label: "Start a quest now",
    batchable: false,
    expectedImpact: () => "Starts a live run immediately.",
    affectedEntities: (action) => (action.type === "start_quest" ? [action.questId] : []),
    validate: (action, context) => {
      if (action.type !== "start_quest") return { report: okReport(context.facts), action };
      if (context.facts.hasActiveRun) {
        return {
          report: blockedReport(context.facts, "run_active", "A quest is already running."),
          action,
        };
      }
      return { report: okReport(context.facts), action };
    },
    execute: async (action, services) => {
      if (action.type !== "start_quest") throw new Error("Wrong action type.");
      const run = await services.startQuest(action.questId);
      return { summary: "Quest started.", affectedEntityIds: [action.questId, run.id] };
    },
  },
];

const REGISTRY = new Map<AgentAction["type"], ActionDefinition>(
  DEFINITIONS.map((definition) => [definition.actionType, definition]),
);

export const ACTION_TYPES: AgentAction["type"][] = DEFINITIONS.map((d) => d.actionType);

export function lookupAction(type: string): ActionDefinition | null {
  return REGISTRY.get(type as AgentAction["type"]) ?? null;
}

export class UnknownActionError extends Error {
  constructor(type: string) {
    super(`Unknown agent action "${type}" — the registry is the only dispatch path.`);
    this.name = "UnknownActionError";
  }
}

export function requireAction(type: string): ActionDefinition {
  const definition = lookupAction(type);
  if (!definition) throw new UnknownActionError(type);
  return definition;
}

export function permissionOf(action: AgentAction): PermissionClass {
  const definition = lookupAction(action.type);
  if (!definition) return "HIGH_IMPACT";
  // A quest that starts itself takes over the player's current attention.
  if (action.type === "create_quest" && action.startImmediately) return "HIGH_IMPACT";
  return definition.permissionClass;
}

export function needsIndividualApproval(action: AgentAction): boolean {
  return permissionOf(action) === "HIGH_IMPACT";
}

export function parseAction(raw: unknown): AgentAction | null {
  if (!raw || typeof raw !== "object") return null;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  const definition = lookupAction(type);
  if (!definition) return null;
  const parsed = definition.schema.safeParse(raw);
  return parsed.success ? (parsed.data as AgentAction) : null;
}

/** Stable per-task key: a retry or a synced duplicate can never execute twice. */
export function idempotencyKeyFor(planId: string, taskId: string, action: AgentAction): string {
  const fingerprint = JSON.stringify(action);
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i += 1) {
    hash = (hash * 31 + fingerprint.charCodeAt(i)) | 0;
  }
  return `${planId}:${taskId}:${action.type}:${(hash >>> 0).toString(36)}`;
}

export function hasDeterministicRollback(action: AgentAction): boolean {
  return Boolean(lookupAction(action.type)?.rollback);
}
