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

export type ContextLayer = "CURRENT" | "RECENT" | "LONG_TERM";

export const CONTEXT_LAYER_LABELS: Record<ContextLayer, string> = {
  CURRENT: "Current",
  RECENT: "Recent",
  LONG_TERM: "Long-term",
};

export interface CurrentLayer {
  time: string;
  identity: { rank: number; sparks: number; run: number; chapter: string; title: string };
  momentum: number;
  state: { energy: number; mood: number; availableMinutes: number } | null;
  goalPriority: string | null;
  todayCompletions: number;
  activeQuest: string | null;
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
  /** Superseded preferences, kept so history is never erased. */
  pastPreferences: string[];
  approvedDecisions: string[];
  memories: { kind: string; text: string }[];
  /** Phase 4B — hypotheses stay labelled, never mixed into facts. */
  hypotheses: string[];
}

export interface PersonalContext {
  layers: ContextLayer[];
  current: CurrentLayer | null;
  recent: RecentLayer | null;
  longTerm: LongTermLayer | null;
  /** Redacted Drive vault metadata — present only when the player allows it. */
  vault: string | null;
  /** Rough size guard so prompts stay bounded. */
  approxTokens: number;
  /** Phase 4B — proof that only a bounded memory slice was included. */
  memoryPackage: MemoryContextPackage | null;
}

export interface ContextOptions {
  layers?: ContextLayer[];
  memories?: MemoryRecord[];
  conversation?: ChatTurn[];
  /** Trim aggressively — used for online providers. */
  minimal?: boolean;
  /** Redacted Drive summary; omitted unless Drive context is switched on. */
  vault?: string | null;
  /** Phase 4B — what this request is about, used for layered memory retrieval. */
  focus?: string;
  /** Phase 4B — ids of goals/quests/recommendations currently in play. */
  entityIds?: string[];
}

const MAX_RECENT = 8;
const MAX_MEMORIES = 8;

export const ALL_LAYERS: ContextLayer[] = ["CURRENT", "RECENT", "LONG_TERM"];

/** The Context Engine's own routing: which layers does this job actually need? */
export function layersForJob(job: string): ContextLayer[] {
  switch (job) {
    case "next_move":
      return ["CURRENT", "RECENT"];
    case "quest":
    case "event":
      return ["CURRENT", "LONG_TERM"];
    case "miss":
    case "analysis":
      return ["CURRENT", "RECENT", "LONG_TERM"];
    case "planning":
      return ["CURRENT", "LONG_TERM"];
    default:
      return ALL_LAYERS;
  }
}

export function buildPersonalContext(
  snapshot: GameSnapshot,
  momentum: number,
  options: ContextOptions = {},
): PersonalContext {
  const layers = options.layers ?? ALL_LAYERS;
  const limit = options.minimal ? 4 : MAX_RECENT;
  const today = snapshot.dailyStates.find((d) => d.id === dayKey()) ?? null;
  const finished = [...snapshot.questRuns]
    .filter((r) => r.outcome !== "in_progress")
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const completed = finished.filter((r) => r.outcome === "completed");

  const current: CurrentLayer | null = layers.includes("CURRENT")
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
        state: today
          ? { energy: today.energy, mood: today.mood, availableMinutes: today.availableMinutes }
          : null,
        goalPriority:
          [...snapshot.destinations]
            .filter((d) => d.status === "active")
            .sort((a, b) => a.priority - b.priority)[0]?.title ?? null,
        todayCompletions: completed.filter((r) => r.startedAt.slice(0, 10) === dayKey()).length,
        activeQuest: snapshot.questRuns.find((r) => r.outcome === "in_progress")?.questName ?? null,
      }
    : null;

  const recent: RecentLayer | null = layers.includes("RECENT")
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
          .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 400) })),
      }
    : null;

  const memories = options.memories ?? [];
  // Phase 4B: layered retrieval picks the smallest useful slice. The full store
  // is never handed to a brain.
  const memoryPackage = layers.includes("LONG_TERM")
    ? buildMemoryContext(memories, {
        ...(options.focus === undefined ? {} : { text: options.focus }),
        ...(options.entityIds === undefined ? {} : { entityIds: options.entityIds }),
        limit: options.minimal ? 4 : MAX_MEMORIES,
      })
    : null;
  const selected = memoryPackage?.lines ?? [];
  const longTerm: LongTermLayer | null = layers.includes("LONG_TERM")
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
          .filter((line) => line.kind === "APPROVED_DECISION")
          .map((line) => line.text),
        memories: selected
          .filter((line) => line.kind === "FACT" || line.kind === "OBSERVED_PATTERN")
          .map((line) => ({ kind: line.kind, text: line.text })),
        hypotheses: selected.filter((line) => line.hypothesis).map((line) => line.text),
      }
    : null;

  const draft: Omit<PersonalContext, "approxTokens" | "memoryPackage"> = {
    layers,
    current,
    recent,
    longTerm,
    vault: options.vault?.trim() ? options.vault.trim() : null,
  };
  return {
    ...draft,
    approxTokens: Math.ceil(JSON.stringify(draft).length / 4),
    memoryPackage,
  };
}
