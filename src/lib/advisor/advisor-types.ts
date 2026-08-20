/**
 * PHASE 4A — AI Life/Game Advisor domain model.
 *
 * Hard boundary: everything in here is a PROPOSAL plus its deterministic
 * evidence. The deterministic engine remains the authority; nothing in this
 * file is game state, and no AI value reaches the game without passing
 * validation and explicit user approval.
 */

import type { StateSignature } from "./state-grade";
import type { AttributeKey, Difficulty } from "../game/types";
import type { MaterialSnapshot } from "./advisor-feedback";

export type RecommendationKind =
  | "quest"
  | "recovery"
  | "routine_change"
  | "goal_adjustment"
  | "experiment"
  | "insight";

export const RECOMMENDATION_KIND_LABELS: Record<RecommendationKind, string> = {
  quest: "Quest",
  recovery: "Recovery",
  routine_change: "Routine change",
  goal_adjustment: "Goal adjustment",
  experiment: "Experiment",
  insight: "Insight",
};

export type RecommendationStatus =
  | "pending"
  | "applied"
  | "rejected"
  | "expired"
  | "superseded"
  | "needs_reapproval";

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  pending: "Waiting for you",
  applied: "Approved & applied",
  rejected: "Declined",
  expired: "Expired",
  superseded: "Replaced",
  needs_reapproval: "Needs a fresh look",
};

/** Explainability layer: a fact is provable, an observation is a pattern, a hypothesis is a guess. */
export type EvidenceKind = "fact" | "observation" | "hypothesis";

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  fact: "Fact",
  observation: "Observation",
  hypothesis: "Hypothesis",
};

export interface EvidenceItem {
  kind: EvidenceKind;
  text: string;
  /** 0..1 — how much this item supports the recommendation. */
  weight: number;
}

export type EvidenceStrength = "strong" | "moderate" | "weak" | "insufficient";

export interface EvidenceScore {
  score: number;
  strength: EvidenceStrength;
  facts: number;
  observations: number;
  hypotheses: number;
  /** Number of finished quest runs the reasoning could draw on. */
  sampleSize: number;
}

export type CrossImpactEffect = "positive" | "neutral" | "risk";

export interface CrossImpact {
  area: string;
  effect: CrossImpactEffect;
  note: string;
}

/** The only shapes the Advisor may ask the deterministic engine to execute. */
export type RecommendationAction =
  | {
      type: "create_quest";
      quest: {
        name: string;
        description: string;
        durationMinutes: number;
        difficulty: Difficulty;
        isRecovery: boolean;
      };
      startImmediately: boolean;
    }
  | {
      type: "create_boost";
      boost: {
        name: string;
        category: string;
        durationMinutes: number;
        difficulty: Difficulty;
        frequency: string;
        preferredTime: string;
        attribute: AttributeKey;
      };
    }
  | {
      type: "create_destination";
      destination: {
        title: string;
        description: string;
        priority: number;
        attributes: AttributeKey[];
      };
    }
  | { type: "add_memory"; memory: { text: string } }
  | { type: "none" };

export const ACTION_TYPE_LABELS: Record<RecommendationAction["type"], string> = {
  create_quest: "Creates a quest",
  create_boost: "Creates a routine (Boost)",
  create_destination: "Creates a goal (Destination)",
  add_memory: "Saves a decision",
  none: "Guidance only",
};

export interface ValidationProblem {
  code: string;
  message: string;
  severity: "block" | "adjust";
}

export interface ValidationReport {
  ok: boolean;
  problems: ValidationProblem[];
  adjustments: string[];
  validatedAt: string;
  /** Fingerprint of the deterministic state the validation was made against. */
  stateHash: string;
  /**
   * The graded-staleness inputs captured at validation time. Optional so
   * records written before Phase 5 keep working (they fall back to the hash).
   */
  stateSignature?: StateSignature;
}

/**
 * One validated way to act on a situation. A recommendation always carries at
 * least one option; when it carries several, exactly one is preferred and every
 * option states what it costs compared to the others.
 */
export interface RecommendationOption {
  id: string;
  label: string;
  summary: string;
  action: RecommendationAction;
  /** What this option gives up — never empty for the preferred option. */
  tradeOff: string;
  validation: ValidationReport | null;
}

export interface RecommendationRecord {
  id: string;
  /** Deterministic trigger that opened this situation. */
  triggerCode: string;
  triggerLabel: string;
  kind: RecommendationKind;
  title: string;
  summary: string;
  /** The preferred option's validated action (kept for direct execution). */
  action: RecommendationAction;
  /** 1..3 validated options; index 0 is not necessarily the preferred one. */
  options: RecommendationOption[];
  preferredOptionIndex: number;
  /** Trade-off explanation for the preferred option. */
  tradeOff: string;
  evidence: EvidenceItem[];
  evidenceScore: EvidenceScore;
  /** 0..1, deterministically capped by evidence strength. */
  confidence: number;
  crossImpacts: CrossImpact[];
  expectedOutcome: string;
  measureAfterHours: number;
  status: RecommendationStatus;
  source: "ai" | "engine";
  brain: string | null;
  validation: ValidationReport | null;
  /** Dedup / supersede key — same situation + same action = same signature. */
  signature: string;
  /** Quest created when the recommendation was applied. */
  questId: string | null;
  /** Momentum recorded at approval time — the baseline for outcome measurement. */
  momentumAtApproval: number | null;
  /** State the recommendation was written for — input to material-change checks. */
  materialSnapshot: MaterialSnapshot;
  /** Option the player actually approved, when they picked a non-preferred one. */
  chosenOptionId: string | null;
  /** True when redacted Drive vault metadata was part of the reasoning context. */
  usedDriveContext: boolean;
  createdAt: string;
  /** Last local touch — read by the sync conflict engine to protect decisions. */
  updatedAt: string;
  decidedAt: string | null;
  expiresAt: string;
}

export const DRIVE_CONTEXT_MARKER = "🗂️ Drive context used";

export type OutcomeResult =
  | "followed_worked"
  | "followed_no_change"
  | "not_followed"
  | "unmeasured";

export const OUTCOME_RESULT_LABELS: Record<OutcomeResult, string> = {
  followed_worked: "Followed — it helped",
  followed_no_change: "Followed — no change",
  not_followed: "Not followed",
  unmeasured: "Not measured yet",
};

export interface RecommendationOutcomeRecord {
  id: string;
  recommendationId: string;
  measuredAt: string;
  result: OutcomeResult;
  note: string;
  metrics: {
    momentumBefore: number;
    momentumAfter: number;
    completionsAfter: number;
    missesAfter: number;
  };
  source: "engine" | "user";
}

export interface DecisionFeedbackRecord {
  id: string;
  recommendationId: string;
  decision: "approved" | "rejected";
  reason: string;
  createdAt: string;
}

export type HistoryEvent =
  | "generated"
  | "revalidated"
  | "approved"
  | "rejected"
  | "applied"
  | "expired"
  | "superseded"
  | "measured";

export interface RecommendationHistoryRecord {
  id: string;
  recommendationId: string;
  event: HistoryEvent;
  detail: string;
  at: string;
}