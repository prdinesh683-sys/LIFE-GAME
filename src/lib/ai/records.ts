/**
 * Persisted AI-side records. These live in the local repository only; they are
 * never authoritative game state. The deterministic engine owns game state.
 */

export type MemoryKind =
  | "FACT"
  | "USER_PREFERENCE"
  | "OBSERVED_PATTERN"
  | "AI_HYPOTHESIS"
  | "APPROVED_DECISION";

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  FACT: "Fact",
  USER_PREFERENCE: "Your preference",
  OBSERVED_PATTERN: "Observed pattern",
  AI_HYPOTHESIS: "AI hypothesis",
  APPROVED_DECISION: "Approved decision",
};

/** Where a memory came from. Provenance answers "why do you remember this?". */
export type MemorySourceType =
  | "USER"
  | "DETERMINISTIC_EVENT"
  | "APPROVED_DECISION"
  | "OBSERVED_PATTERN"
  | "AI_HYPOTHESIS"
  | "IMPORT"
  | "DRIVE";

export const MEMORY_SOURCE_LABELS: Record<MemorySourceType, string> = {
  USER: "You said this",
  DETERMINISTIC_EVENT: "Recorded by the game engine",
  APPROVED_DECISION: "A decision you approved",
  OBSERVED_PATTERN: "Repeated behaviour in your own records",
  AI_HYPOTHESIS: "An AI guess, still unproven",
  IMPORT: "Imported information",
  DRIVE: "From your Drive vault (untrusted data)",
};

export type MemoryStatus = "active" | "archived" | "superseded";

export type MemoryConfidenceBand = "low" | "medium" | "high";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  source: "user" | "engine" | "ai";
  confidence: number | null;
  createdAt: string;
  pinned: boolean;

  /* Phase 4B — additive metadata. Older rows omit these; normalizeMemory fills them. */
  updatedAt?: string;
  /** Richer provenance than the coarse `source` field. */
  sourceType?: MemorySourceType;
  /** Id of the originating record (recommendation, quest run, event, import…). */
  sourceId?: string | null;
  deviceId?: string | null;
  status?: MemoryStatus;
  /** Deterministic 0-100 score. Never invented by an AI. */
  importanceScore?: number;
  version?: number;
  previousVersionId?: string | null;
  /** Preference evolution: when this statement started/stopped being true. */
  effectiveFrom?: string;
  effectiveTo?: string | null;
  /** Ids of runs/events/recommendations that back this memory. */
  supportingEvidenceIds?: string[];
  /** Ids of goals, quests, boosts, recommendations this memory talks about. */
  relatedEntityIds?: string[];
  /** How often the retrieval layer actually used this memory. */
  useCount?: number;
  /** Deterministic dedupe key. */
  signature?: string;
  /** Set when consolidation folded other memories into this one. */
  consolidatedFrom?: string[];
  /** Contradicting evidence kept instead of being overwritten. */
  contradictions?: string[];
}

/** Fully-populated memory — every Phase 4B field resolved to a concrete value. */
export type NormalizedMemory = MemoryRecord &
  Required<
    Pick<
      MemoryRecord,
      | "updatedAt"
      | "sourceType"
      | "status"
      | "importanceScore"
      | "version"
      | "effectiveFrom"
      | "supportingEvidenceIds"
      | "relatedEntityIds"
      | "useCount"
      | "signature"
      | "contradictions"
    >
  >;

/** Stable dedupe signature: kind + normalized text (+ entity when known). */
export function memorySignature(input: {
  kind: MemoryKind;
  text: string;
  relatedEntityIds?: string[];
}): string {
  const normalized = input.text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const entity = [...(input.relatedEntityIds ?? [])].sort().join(",");
  return `${input.kind}|${normalized}${entity ? `|${entity}` : ""}`;
}

function defaultSourceType(record: MemoryRecord): MemorySourceType {
  if (record.kind === "APPROVED_DECISION") return "APPROVED_DECISION";
  if (record.kind === "OBSERVED_PATTERN") return "OBSERVED_PATTERN";
  if (record.kind === "AI_HYPOTHESIS") return "AI_HYPOTHESIS";
  if (record.source === "user") return "USER";
  if (record.source === "ai") return "AI_HYPOTHESIS";
  return "DETERMINISTIC_EVENT";
}

/** Backfills Phase 4B fields so pre-4B rows stay valid and comparable. */
export function normalizeMemory(record: MemoryRecord): NormalizedMemory {
  return {
    ...record,
    updatedAt: record.updatedAt ?? record.createdAt,
    sourceType: record.sourceType ?? defaultSourceType(record),
    sourceId: record.sourceId ?? null,
    deviceId: record.deviceId ?? null,
    status: record.status ?? "active",
    importanceScore: record.importanceScore ?? 0,
    version: record.version ?? 1,
    previousVersionId: record.previousVersionId ?? null,
    effectiveFrom: record.effectiveFrom ?? record.createdAt,
    effectiveTo: record.effectiveTo ?? null,
    supportingEvidenceIds: record.supportingEvidenceIds ?? [],
    relatedEntityIds: record.relatedEntityIds ?? [],
    useCount: record.useCount ?? 0,
    signature: record.signature ?? memorySignature(record),
    contradictions: record.contradictions ?? [],
  };
}

/** Typed, queryable edge between a memory and another record. */
export type MemoryRelation =
  | "supports"
  | "contradicts"
  | "derived_from"
  | "related_to"
  | "produced"
  | "supersedes";

export const MEMORY_RELATION_LABELS: Record<MemoryRelation, string> = {
  supports: "supports",
  contradicts: "contradicts",
  derived_from: "derived from",
  related_to: "related to",
  produced: "produced",
  supersedes: "supersedes",
};

export type MemoryEntityKind =
  | "memory"
  | "goal"
  | "quest"
  | "questRun"
  | "boost"
  | "drain"
  | "recommendation"
  | "outcome"
  | "pattern"
  | "event";

export interface MemoryLinkRecord {
  id: string;
  memoryId: string;
  relation: MemoryRelation;
  targetKind: MemoryEntityKind;
  targetId: string;
  /** Short human-readable label for the timeline/detail UI. */
  label: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string | null;
}


export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTurn {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  /** Plain text shown in the bubble. */
  text: string;
  /** Structured blocks for assistant turns (never mixed with facts). */
  known: string[];
  patterns: string[];
  hypotheses: string[];
  recommendation: string | null;
  confidence: number | null;
  source: "ai" | "engine";
  brain: string | null;
  proposalId: string | null;
  createdAt: string;
}

export type ProposalKind =
  | "goal_plan"
  | "quest"
  | "event"
  | "behavior_analysis"
  /** Phase 4B — AI-suggested memories. Never written without user approval. */
  | "memory"
  | "missed_quest_analysis"
  | "plan_change";

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  goal_plan: "Goal Plan",
  quest: "Quest",
  event: "Event",
  behavior_analysis: "Behavior Analysis",
  memory: "Memory Suggestion",
  missed_quest_analysis: "Missed Quest Analysis",
  plan_change: "Plan Change",
};

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied";

export interface ProposalRecord {
  id: string;
  kind: ProposalKind;
  title: string;
  summary: string;
  /** Validated structured payload — see schemas.ts */
  payload: unknown;
  factsUsed: string[];
  hypotheses: string[];
  confidence: number | null;
  source: "ai" | "engine";
  brain: string | null;
  status: ProposalStatus;
  createdAt: string;
  decidedAt: string | null;
  conversationId: string | null;
}
