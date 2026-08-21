import type { GameSnapshot } from "../game/types";
import { detectPatterns } from "../game/behavior-engine";
import { dayKey } from "../game/run-engine";
import { buildMemoryContext, type MemoryContextPackage } from "../memory/memory-retrieval";
import { currentPreferences, historicalPreferences } from "../memory/memory-versioning";
import type { ChatTurn, MemoryRecord } from "./records";

/**
 * PersonalContextService — builds a small, bounded, structured context.
 *
 * It never dumps the database into a prompt. Each request declares which layers
 * it needs; cloud requests should ask for the minimum (privacy rule).
 */

export type ContextLayer =
  | "TURN" // Layer 0
  | "CURRENT_STATE" // Layer 1
  | "TODAY" // Layer 2
  | "RECENT" // Layer 3
  | "LONG_TERM" // Layer 4
  | "RETRIEVED"; // Layer 5

export const CONTEXT_LAYER_LABELS: Record<ContextLayer, string> = {
  TURN: "Layer 0: Turn",
  CURRENT_STATE: "Layer 1: State Snapshot",
  TODAY: "Layer 2: Today Context",
  RECENT: "Layer 3: Recent Context",
  LONG_TERM: "Layer 4: Long-Term Memory",
  RETRIEVED: "Layer 5: Retrieved Evidence",
};

export interface TurnLayer {
  userQuery?: string;
  role?: string;
}

export interface CurrentStateLayer {
  time: string;
  identity: { rank: number; sparks: number; run: number; chapter: string; title: string };
  momentum: number;
  activeGoal: string | null;
  activeChapter?: string | null;
  activeMilestone?: string | null;
  activeQuest: string | null;
  capacityMinutes: number;
  currentEnergy: number;
  currentMood: number;
}

export interface TodayLayer {
  date: string;
  energy: number;
  mood: number;
  availableMinutes: number;
  completionsToday: number;
  completedQuests: string[];
  blockers: string[];
  note: string;
}

export interface RecentLayer {
  quests: { name: string; outcome: string; when: string }[];
  misses: { name: string; reason: string | null; note: string | null }[];
  completionRate: number | null;
  patterns: string[];
  conversation: { role: string; text: string }[];
}

export interface LongTermLayer {
  blueprint: {
    direction: string;
    goals: string[];
    priorities: string[];
    antiGoals: string[];
    constraints: string[];
    preferredDifficulty: string;
    preferredQuestStyle: string;
  } | null;
  destinations: { title: string; progress: number; priority: number }[];
  boosts: { name: string; category: string; minutes: number }[];
  drains: { name: string; trigger: string; replacement: string }[];
  preferences: string[];
  pastPreferences: string[];
  approvedDecisions: string[];
  memories: { kind: string; text: string }[];
  hypotheses: string[];
}

export interface RetrievedLayer {
  focus: string;
  evidenceItems: { id: string; summary: string; relevanceScore: number }[];
}

export interface ContextInclusionRationale {
  layer: ContextLayer;
  reason: string;
  tokenCost: number;
}

export interface PersonalContext {
  layers: ContextLayer[];
  turn?: TurnLayer | null;
  currentState?: CurrentStateLayer | null;
  today?: TodayLayer | null;
  recent?: RecentLayer | null;
  longTerm?: LongTermLayer | null;
  retrieved?: RetrievedLayer | null;
  /** Redacted Drive vault metadata — present only when the player allows it. */
  vault: string | null;
  approxTokens: number;
  inclusionRationales: ContextInclusionRationale[];
  memoryPackage: MemoryContextPackage | null;
  // Backwards compatibility aliases
  current?: CurrentStateLayer | null;
}

export interface ContextOptions {
  layers?: ContextLayer[];
  turnQuery?: string;
  memories?: MemoryRecord[];
  conversation?: ChatTurn[];
  minimal?: boolean;
  vault?: string | null;
  focus?: string;
  entityIds?: string[];
  tokenBudget?: number;
}

const MAX_RECENT = 8;
const MAX_MEMORIES = 8;
const DEFAULT_TOKEN_BUDGET = 2000;

export const ALL_LAYERS: ContextLayer[] = [
  "TURN",
  "CURRENT_STATE",
  "TODAY",
  "RECENT",
  "LONG_TERM",
  "RETRIEVED",
];

export function layersForJob(job: string): ContextLayer[] {
  switch (job) {
    case "next_move":
      return ["TURN", "CURRENT_STATE", "TODAY", "RECENT"];
    case "quest":
    case "event":
      return ["TURN", "CURRENT_STATE", "LONG_TERM"];
    case "situation":
    case "goal_clarification":
      return ["TURN", "CURRENT_STATE", "LONG_TERM"];
    case "daily_interpretation":
      return ["TURN", "CURRENT_STATE", "TODAY"];
    case "miss":
    case "analysis":
    case "reflection":
      return ["TURN", "CURRENT_STATE", "TODAY", "RECENT", "LONG_TERM"];
    case "planning":
      return ["TURN", "CURRENT_STATE", "LONG_TERM", "RETRIEVED"];
    default:
      return ALL_LAYERS;
  }
}

export function buildPersonalContext(
  snapshot: GameSnapshot,
  momentum: number,
  options: ContextOptions = {},
): PersonalContext {
  const selectedLayers = options.layers ?? ALL_LAYERS;
  const limit = options.minimal ? 4 : MAX_RECENT;
  const todayState = snapshot.dailyStates.find((d) => d.id === dayKey()) ?? null;
  const finished = [...snapshot.questRuns]
    .filter((r) => r.outcome !== "in_progress")
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const completed = finished.filter((r) => r.outcome === "completed");
  const todayRuns = completed.filter((r) => r.startedAt.slice(0, 10) === dayKey());

  const rationales: ContextInclusionRationale[] = [];

  // Layer 0: Turn
  const turn: TurnLayer | null = selectedLayers.includes("TURN") && options.turnQuery
    ? { userQuery: options.turnQuery }
    : null;
  if (turn) {
    rationales.push({
      layer: "TURN",
      reason: "Immediate conversational or instructional input for this execution turn.",
      tokenCost: Math.ceil(JSON.stringify(turn).length / 4),
    });
  }

  // Layer 1: Current State
  const activeDest = [...snapshot.destinations]
    .filter((d) => d.status === "active")
    .sort((a, b) => a.priority - b.priority)[0] ?? null;

  const currentState: CurrentStateLayer | null = selectedLayers.includes("CURRENT_STATE")
    ? {
        time: new Date().toISOString(),
        identity: {
          rank: snapshot.profile.rank,
          sparks: snapshot.profile.sparks,
          run: snapshot.profile.currentRun,
          chapter: snapshot.profile.chapter,
          title: snapshot.profile.title,
        },
        momentum,
        activeGoal: activeDest?.title ?? null,
        activeChapter: snapshot.chapters?.find((c) => c.destinationId === activeDest?.id)?.title ?? null,
        activeMilestone: snapshot.milestones.find((m) => m.destinationId === activeDest?.id && !m.done)?.title ?? null,
        activeQuest: snapshot.questRuns.find((r) => r.outcome === "in_progress")?.questName ?? null,
        capacityMinutes: todayState?.availableMinutes ?? 30,
        currentEnergy: todayState?.energy ?? 3,
        currentMood: todayState?.mood ?? 3,
      }
    : null;
  if (currentState) {
    rationales.push({
      layer: "CURRENT_STATE",
      reason: "Core state snapshot: rank, active goal/chapter/milestone, energy, and capacity.",
      tokenCost: Math.ceil(JSON.stringify(currentState).length / 4),
    });
  }

  // Layer 2: Today Context
  const today: TodayLayer | null = selectedLayers.includes("TODAY")
    ? {
        date: dayKey(),
        energy: todayState?.energy ?? 3,
        mood: todayState?.mood ?? 3,
        availableMinutes: todayState?.availableMinutes ?? 30,
        completionsToday: todayRuns.length,
        completedQuests: todayRuns.map((r) => r.questName),
        blockers: finished
          .filter((r) => r.outcome === "missed" && r.startedAt.slice(0, 10) === dayKey())
          .map((r) => r.missReason || "unknown"),
        note: todayState?.note ?? "",
      }
    : null;
  if (today) {
    rationales.push({
      layer: "TODAY",
      reason: "Today's specific capacity, recorded completions, and noted blockers.",
      tokenCost: Math.ceil(JSON.stringify(today).length / 4),
    });
  }

  // Layer 3: Recent Context
  const recent: RecentLayer | null = selectedLayers.includes("RECENT")
    ? {
        quests: finished.slice(0, limit).map((r) => ({
          name: r.questName,
          outcome: r.outcome,
          when: r.startedAt,
        })),
        misses: finished
          .filter((r) => r.outcome === "missed")
          .slice(0, options.minimal ? 3 : 5)
          .map((r) => ({ name: r.questName, reason: r.missReason, note: r.missNote })),
        completionRate: finished.length ? completed.length / finished.length : null,
        patterns: detectPatterns(snapshot.questRuns, snapshot.events).map((p) => p.label),
        conversation: (options.conversation ?? [])
          .slice(-(options.minimal ? 2 : 6))
          .map((t) => ({ role: t.role, text: t.text.slice(0, 400) })),
      }
    : null;
  if (recent) {
    rationales.push({
      layer: "RECENT",
      reason: "Recency window of recent runs, misses, and detected behavioral patterns.",
      tokenCost: Math.ceil(JSON.stringify(recent).length / 4),
    });
  }

  // Layer 4 & Layer 5: Long-term & Retrieved Evidence
  const memories = options.memories ?? [];
  const memoryPackage = selectedLayers.includes("LONG_TERM") || selectedLayers.includes("RETRIEVED")
    ? buildMemoryContext(memories, {
        ...(options.focus === undefined ? {} : { text: options.focus }),
        ...(options.entityIds === undefined ? {} : { entityIds: options.entityIds }),
        limit: options.minimal ? 4 : MAX_MEMORIES,
      })
    : null;

  const selected = memoryPackage?.lines ?? [];

  const longTerm: LongTermLayer | null = selectedLayers.includes("LONG_TERM")
    ? {
        blueprint: snapshot.blueprint
          ? {
              direction: snapshot.blueprint.direction,
              goals: snapshot.blueprint.goals,
              priorities: snapshot.blueprint.priorities,
              antiGoals: snapshot.blueprint.antiGoals,
              constraints: snapshot.blueprint.constraints,
              preferredDifficulty: snapshot.blueprint.preferredDifficulty,
              preferredQuestStyle: snapshot.blueprint.preferredQuestStyle,
            }
          : null,
        destinations: snapshot.destinations
          .filter((d) => d.status === "active")
          .slice(0, 4)
          .map((d) => ({ title: d.title, progress: d.progress, priority: d.priority })),
        boosts: snapshot.boosts
          .slice(0, options.minimal ? 4 : 8)
          .map((b) => ({ name: b.name, category: b.category, minutes: b.durationMinutes })),
        drains: snapshot.drains
          .slice(0, options.minimal ? 3 : 6)
          .map((d) => ({ name: d.name, trigger: d.trigger, replacement: d.replacement })),
        preferences: currentPreferences(memories).map((m) => m.text),
        pastPreferences: options.minimal
          ? []
          : historicalPreferences(memories).slice(0, 4).map((m) => m.text),
        approvedDecisions: selected
          .filter((l) => l.kind === "APPROVED_DECISION")
          .map((l) => l.text),
        memories: selected
          .filter((l) => l.kind === "FACT" || l.kind === "OBSERVED_PATTERN")
          .map((l) => ({ kind: l.kind, text: l.text })),
        hypotheses: selected.filter((l) => l.hypothesis).map((l) => l.text),
      }
    : null;
  if (longTerm) {
    rationales.push({
      layer: "LONG_TERM",
      reason: "Long-term blueprint goals, stable preferences, and approved decisions.",
      tokenCost: Math.ceil(JSON.stringify(longTerm).length / 4),
    });
  }

  const retrieved: RetrievedLayer | null = selectedLayers.includes("RETRIEVED") && options.focus
    ? {
        focus: options.focus,
        evidenceItems: selected.map((s, idx) => ({
          id: `ev_${idx}`,
          summary: s.text,
          relevanceScore: s.hypothesis ? 0.4 : 0.8,
        })),
      }
    : null;
  if (retrieved) {
    rationales.push({
      layer: "RETRIEVED",
      reason: `Focused retrieved evidence for query "${options.focus}".`,
      tokenCost: Math.ceil(JSON.stringify(retrieved).length / 4),
    });
  }

  const draft = {
    layers: selectedLayers,
    turn,
    currentState,
    today,
    recent,
    longTerm,
    retrieved,
    vault: options.vault?.trim() ? options.vault.trim() : null,
    // backwards compatibility mapping
    current: currentState,
  };

  const totalTokens = Math.ceil(JSON.stringify(draft).length / 4);

  return {
    ...draft,
    approxTokens: totalTokens,
    inclusionRationales: rationales,
    memoryPackage,
  };
}

/**
 * Cloud Privacy Sanitizer (CHANGE 3):
 * Strips absolute local filesystem paths, machine identifiers, and temporary IDE paths
 * before sending context to external/cloud LLM providers while preserving semantic meaning.
 */
export function sanitizeTextForCloud(raw: string): string {
  if (!raw) return raw;
  return raw
    // Remove file:/// URLs first so drive paths within them are properly captured
    .replace(/file:\/\/\/[^\s'")]+/g, "[local_file]")
    // Remove Windows drive absolute paths e.g. C:\Users\... or C:\\Users\\...
    .replace(/[a-zA-Z]:(?:\/|\\\\|\\)[^\s"'{}\[\],;]+/g, "[local_path]")
    // Remove Unix absolute paths e.g. /home/... or /Users/...
    .replace(/\/(?:Users|home|tmp|var|opt)\/[^\s"'{}\[\],;]+/g, "[local_path]")
    // Remove temporary brain paths
    .replace(/\.gemini(?:\/|\\\\|\\)antigravity-ide(?:\/|\\\\|\\)[^\s"'{}\[\],;]+/g, "[system_path]");
}

export function sanitizeContextForCloud(context: PersonalContext): PersonalContext {
  const serialized = JSON.stringify(context);
  const sanitizedJson = sanitizeTextForCloud(serialized);
  try {
    return JSON.parse(sanitizedJson) as PersonalContext;
  } catch {
    return context;
  }
}
