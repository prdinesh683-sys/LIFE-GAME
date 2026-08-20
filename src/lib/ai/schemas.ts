import { z } from "zod";

/**
 * AI RESPONSE CONTRACT.
 *
 * Every AI job returns JSON validated here before the app looks at it. A
 * malformed response is rejected and the deterministic engine answers instead.
 * Nothing validated here is applied to game state directly: proposals go to the
 * deterministic engines (and, for plan-level changes, to the user) first.
 */

const difficulty = z.enum(["trivial", "easy", "normal", "hard", "extreme"]);

const meta = {
  confidence: z.number().min(0).max(1).default(0.5),
  facts_used: z.array(z.string()).default([]),
  hypotheses: z.array(z.string()).default([]),
};

export const chatAnswerSchema = z.object({
  type: z.literal("chat").default("chat"),
  answer: z.string(),
  known_data: z.array(z.string()).default([]),
  observed_patterns: z.array(z.string()).default([]),
  hypotheses: z.array(z.string()).default([]),
  recommendation: z.string().nullable().default(null),
  confidence: meta.confidence,
});
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

export const nextMoveSchema = z.object({
  type: z.literal("next_move").default("next_move"),
  recommendations: z
    .array(
      z.object({
        title: z.string(),
        reason: z.string(),
        duration_minutes: z.number(),
        difficulty: difficulty.default("normal"),
        attribute: z.string().nullable().default(null),
        rush: z.boolean().default(false),
        is_recovery: z.boolean().default(false),
      }),
    )
    .default([]),
  ...meta,
});
export type NextMoveResponse = z.infer<typeof nextMoveSchema>;

export const questSchema = z.object({
  type: z.literal("quest").default("quest"),
  quest: z.object({
    name: z.string(),
    description: z.string().default(""),
    duration_minutes: z.number(),
    difficulty: difficulty.default("normal"),
    attribute: z.string().nullable().default(null),
    goal: z.string().default(""),
  }),
  ...meta,
});
export type QuestResponse = z.infer<typeof questSchema>;

export const eventSchema = z.object({
  type: z.literal("event").default("event"),
  event: z.object({
    name: z.string(),
    kind: z.string().default("wildcard"),
    description: z.string().default(""),
    duration_minutes: z.number().default(15),
    reward_note: z.string().default(""),
  }),
  ...meta,
});
export type EventResponse = z.infer<typeof eventSchema>;

export const goalPlanSchema = z.object({
  type: z.literal("goal_plan").default("goal_plan"),
  destination: z.object({
    title: z.string(),
    description: z.string().default(""),
    priority: z.number().default(2),
    duration_weeks: z.number().default(4),
    attributes: z.array(z.string()).default([]),
    difficulty: difficulty.default("normal"),
    is_boss: z.boolean().default(false),
  }),
  milestones: z.array(z.string()).default([]),
  quests: z
    .array(
      z.object({
        name: z.string(),
        duration_minutes: z.number(),
        difficulty: difficulty.default("normal"),
        attribute: z.string().nullable().default(null),
      }),
    )
    .default([]),
  schedule: z.string().default(""),
  risks: z.array(z.string()).default([]),
  boosts: z.array(z.string()).default([]),
  possible_drains: z.array(z.string()).default([]),
  trophies: z.array(z.string()).default([]),
  ...meta,
});
export type GoalPlanResponse = z.infer<typeof goalPlanSchema>;

export const missAnalysisSchema = z.object({
  type: z.literal("missed_quest_analysis").default("missed_quest_analysis"),
  likely_reason: z.string(),
  supporting_facts: z.array(z.string()).default([]),
  recommended_recovery: z.object({
    title: z.string(),
    duration_minutes: z.number(),
  }),
  proposed_adjustment: z.string().default(""),
  ...meta,
});
export type MissAnalysisResponse = z.infer<typeof missAnalysisSchema>;

export const behaviorAnalysisSchema = z.object({
  type: z.literal("behavior_analysis").default("behavior_analysis"),
  confirmed_facts: z.array(z.string()).default([]),
  observed_patterns: z.array(z.string()).default([]),
  hypotheses: z.array(z.string()).default([]),
  possible_drains: z.array(z.string()).default([]),
  successful_boosts: z.array(z.string()).default([]),
  recommended_experiments: z.array(z.string()).default([]),
  suggested_changes: z.array(z.string()).default([]),
  confidence: meta.confidence,
  facts_used: meta.facts_used,
});
export type BehaviorAnalysisResponse = z.infer<typeof behaviorAnalysisSchema>;

export class MalformedAiResponseError extends Error {
  constructor(
    public readonly raw: string,
    detail: string,
  ) {
    super(`AI returned an unusable response: ${detail}`);
    this.name = "MalformedAiResponseError";
  }
}

/**
 * PHASE 4A — Advisor response contract. The Advisor may only propose; every
 * numeric value below is re-derived or clamped by the deterministic engine
 * before the player ever sees it.
 */
export const advisorSchema = z.object({
  type: z.literal("advisor").default("advisor"),
  recommendations: z
    .array(
      z.object({
        trigger_code: z.string().default(""),
        kind: z
          .enum(["quest", "recovery", "routine_change", "goal_adjustment", "experiment", "insight"])
          .default("insight"),
        title: z.string(),
        summary: z.string().default(""),
        quest: z
          .object({
            name: z.string(),
            description: z.string().default(""),
            duration_minutes: z.number(),
            difficulty: difficulty.default("normal"),
            is_recovery: z.boolean().default(false),
          })
          .nullable()
          .default(null),
        start_immediately: z.boolean().default(false),
        trade_off: z.string().default(""),
        options: z
          .array(
            z.object({
              label: z.string().default(""),
              summary: z.string().default(""),
              trade_off: z.string().default(""),
              quest: z
                .object({
                  name: z.string(),
                  description: z.string().default(""),
                  duration_minutes: z.number(),
                  difficulty: difficulty.default("normal"),
                  is_recovery: z.boolean().default(false),
                })
                .nullable()
                .default(null),
              start_immediately: z.boolean().default(false),
              note: z.string().default(""),
            }),
          )
          .max(3)
          .default([]),
        facts: z.array(z.string()).default([]),
        observations: z.array(z.string()).default([]),
        hypotheses: z.array(z.string()).default([]),
        cross_impacts: z
          .array(
            z.object({
              area: z.string(),
              effect: z.enum(["positive", "neutral", "risk"]).default("neutral"),
              note: z.string().default(""),
            }),
          )
          .default([]),
        expected_outcome: z.string().default(""),
        measure_after_hours: z.number().default(24),
        confidence: meta.confidence,
      }),
    )
    .default([]),
  ...meta,
});
export type AdvisorResponse = z.infer<typeof advisorSchema>;

/**
 * PHASE 4A — semantic half of material-change detection. The deterministic
 * engine already found the change; the brain may only judge whether it makes
 * the existing advice worth rewriting.
 */
export const changeRelevanceSchema = z.object({
  type: z.literal("change_relevance").default("change_relevance"),
  still_valid: z.boolean().default(true),
  reason: z.string().default(""),
  ...meta,
});
export type ChangeRelevanceResponse = z.infer<typeof changeRelevanceSchema>;

/**
 * PHASE 4B — AI memory proposals. A brain may only *propose* a memory; the
 * proposal is schema-validated before it can enter the persistent pipeline, and
 * a hypothesis can never be proposed as a fact or an approved decision.
 */
export const memoryProposalSchema = z.object({
  type: z.literal("memory_proposal").default("memory_proposal"),
  memories: z
    .array(
      z.object({
        kind: z.enum(["FACT", "OBSERVED_PATTERN", "AI_HYPOTHESIS"]),
        text: z.string().min(4).max(400),
        supporting_evidence_ids: z.array(z.string()).default([]),
        related_entity_ids: z.array(z.string()).default([]),
        confidence: z.number().min(0).max(1).default(0.4),
      }),
    )
    .max(5)
    .default([]),
  ...meta,
});
export type MemoryProposalResponse = z.infer<typeof memoryProposalSchema>;

/** Pull the first JSON object out of a model reply, tolerating code fences. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
    try {
      return JSON.parse(slice);
    } catch {
      /* try the next candidate */
    }
  }
  throw new MalformedAiResponseError(raw, "no JSON object found");
}

export function parseStructured<S extends z.ZodTypeAny>(schema: S, raw: string): z.output<S> {
  const json = extractJson(raw);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new MalformedAiResponseError(raw, result.error.issues[0]?.message ?? "schema mismatch");
  }
  return result.data;
}
