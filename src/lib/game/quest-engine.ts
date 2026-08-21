import type {
  AttributeKey,
  Difficulty,
  EconomyConfig,
  MinimumWin,
  Quest,
  QuestStatus,
  QuestType,
} from "./types";
import type { TimeWindow } from "./time-window";
import { sparksForQuest } from "./reward-engine";

/**
 * QuestEngine — quest lifecycle, validation and Rush windows.
 * The AI layer may only *propose* quest drafts; this engine normalises and
 * validates them before anything is persisted.
 */

export interface QuestDraft {
  name: string;
  description?: string;
  category?: string;
  type?: QuestType;
  durationMinutes: number;
  difficulty?: Difficulty;
  attribute?: AttributeKey;
  destinationId?: string | null;
  chapterId?: string | null;
  milestoneId?: string | null;
  boostId?: string | null;
  isRecovery?: boolean;
  rushWindowSeconds?: number | null;
  createdBy?: Quest["createdBy"];
  aiGenerated?: boolean;
  /** Optional part of the day. Absent or null means anytime. */
  timeWindow?: TimeWindow | null;
  /** Optional local day key (YYYY-MM-DD). */
  scheduledFor?: string | null;
  /** Optional lowest-friction micro version */
  minimumWin?: MinimumWin | null;
}

export const DURATION_BOUNDS: Record<QuestType, [number, number]> = {
  quick: [5, 10],
  normal: [10, 30],
  focus: [20, 60],
  rush: [5, 30],
  epic: [45, 240],
  wildcard: [5, 45],
};

export function inferQuestType(durationMinutes: number): QuestType {
  if (durationMinutes <= 10) return "quick";
  if (durationMinutes <= 30) return "normal";
  if (durationMinutes <= 60) return "focus";
  return "epic";
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateDraft(draft: QuestDraft): ValidationResult {
  const errors: string[] = [];
  if (!draft.name || draft.name.trim().length < 2) errors.push("Quest needs a name.");
  if (!Number.isFinite(draft.durationMinutes) || draft.durationMinutes < 1) {
    errors.push("Duration must be at least 1 minute.");
  }
  if (draft.durationMinutes > 480) errors.push("Duration cannot exceed 8 hours.");
  return { ok: errors.length === 0, errors };
}

let questCounter = 0;

export function newId(prefix: string): string {
  questCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${questCounter.toString(36)}`;
}

/** AI proposes → engine validates → system applies. */
export function materialiseQuest(
  config: EconomyConfig,
  draft: QuestDraft,
  nowIso: string,
): Quest {
  const validation = validateDraft(draft);
  if (!validation.ok) throw new Error(validation.errors.join(" "));

  const duration = Math.round(draft.durationMinutes);
  const type = draft.type ?? inferQuestType(duration);
  const difficulty = draft.difficulty ?? "normal";

  return {
    id: newId("quest"),
    name: draft.name.trim(),
    description: draft.description?.trim() ?? "",
    category: draft.category ?? "general",
    type,
    durationMinutes: duration,
    difficulty,
    sparks: sparksForQuest(config, duration, difficulty),
    attribute: draft.attribute ?? "focus",
    destinationId: draft.destinationId ?? null,
    chapterId: draft.chapterId ?? null,
    milestoneId: draft.milestoneId ?? null,
    boostId: draft.boostId ?? null,
    scheduledFor: draft.scheduledFor ?? null,
    timeWindow: draft.timeWindow ?? null,
    status: "available",
    verification: "unverified",
    createdBy: draft.createdBy ?? "engine",
    aiGenerated: draft.aiGenerated ?? false,
    // AI-generated quests need approval; engine/user quests are pre-approved.
    approved: !(draft.aiGenerated ?? false),
    isRecovery: draft.isRecovery ?? false,
    rushWindowSeconds: draft.rushWindowSeconds ?? (type === "rush" ? 60 : null),
    minimumWin: draft.minimumWin ?? null,
    createdAt: nowIso,
  };
}

const ALLOWED: Record<QuestStatus, QuestStatus[]> = {
  available: ["active", "archived", "missed"],
  active: ["completed", "missed", "available"],
  completed: ["archived"],
  missed: ["available", "archived"],
  archived: [],
};

export function canTransition(from: QuestStatus, to: QuestStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function rushDeadline(quest: Quest, startedAtIso: string): number | null {
  if (!quest.rushWindowSeconds) return null;
  return Date.parse(startedAtIso) + quest.rushWindowSeconds * 1000;
}