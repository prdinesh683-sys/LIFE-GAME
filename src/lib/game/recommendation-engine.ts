import type {
  AttributeKey,
  Boost,
  DailyState,
  Destination,
  Difficulty,
  EconomyConfig,
  NextMoveCategory,
  PersonalBlueprint,
  QuestRun,
} from "./types";
import { sparksForQuest } from "./reward-engine";
import type { QuestDraft } from "./quest-engine";

/**
 * RecommendationEngine — the deterministic fallback brain for Next Move ⚡.
 * This runs with zero network, zero AI, and always produces usable options.
 */

export interface NextMoveOption {
  id: string;
  category: NextMoveCategory;
  title: string;
  durationMinutes: number;
  reason: string;
  sparks: number;
  attribute: AttributeKey;
  destinationId: string | null;
  destinationTitle: string | null;
  difficulty: Difficulty;
  boostId: string | null;
  isRecovery: boolean;
  rush: boolean;
  source: "engine" | "ai";
}

const CATEGORY_ATTRIBUTES: Record<string, AttributeKey> = {
  movement: "vitality",
  learning: "knowledge",
  work: "focus",
  project: "craft",
  outdoors: "exploration",
  social: "connection",
  creative: "creativity",
  home: "order",
};

function scaleForTime(minutes: number, available: number): number {
  if (available <= 0) return minutes;
  return Math.max(5, Math.min(minutes, available));
}

function difficultyForEnergy(energy: number): Difficulty {
  if (energy <= 1) return "trivial";
  if (energy === 2) return "easy";
  if (energy === 3) return "normal";
  if (energy === 4) return "hard";
  return "extreme";
}

export interface RecommendationInput {
  config: EconomyConfig;
  boosts: Boost[];
  destinations: Destination[];
  runs: QuestRun[];
  today: DailyState | null;
  momentum: number;
  blueprint: PersonalBlueprint | null;
  needsRecovery: boolean;
  seed: number;
}

export function generateNextMoves(input: RecommendationInput): NextMoveOption[] {
  const { config, boosts, destinations, today, momentum, needsRecovery, seed } = input;
  const energy = today?.energy ?? 3;
  const available = today?.availableMinutes ?? 30;
  const activeDestinations = destinations.filter((d) => d.status === "active");

  const pickDestination = (attribute: AttributeKey): Destination | null =>
    activeDestinations.find((d) => d.attributes.includes(attribute)) ?? activeDestinations[0] ?? null;

  const completedNames = new Set(
    input.runs
      .filter((r) => r.outcome === "completed" && Date.now() - Date.parse(r.startedAt) < 12 * 3600000)
      .map((r) => r.questName),
  );

  const candidates: NextMoveOption[] = [];

  const push = (
    category: NextMoveCategory,
    boost: Boost | undefined,
    fallback: { title: string; minutes: number; attribute: AttributeKey },
    reason: string,
    options?: { rush?: boolean; recovery?: boolean; difficulty?: Difficulty },
  ) => {
    const title = boost?.name ?? fallback.title;
    if (completedNames.has(title) && category !== "recovery") return;
    const attribute = boost?.attribute ?? fallback.attribute;
    const minutes = scaleForTime(boost?.durationMinutes ?? fallback.minutes, available);
    const difficulty = options?.difficulty ?? difficultyForEnergy(energy);
    const destination = pickDestination(attribute);
    candidates.push({
      id: `${category}_${title.toLowerCase().replace(/\s+/g, "-")}`,
      category,
      title,
      durationMinutes: minutes,
      reason,
      sparks: sparksForQuest(config, minutes, difficulty),
      attribute,
      destinationId: destination?.id ?? null,
      destinationTitle: destination?.title ?? null,
      difficulty,
      boostId: boost?.id ?? null,
      isRecovery: options?.recovery ?? false,
      rush: options?.rush ?? false,
      source: "engine",
    });
  };

  if (needsRecovery || momentum < config.recoveryMomentumFloor) {
    push(
      "recovery",
      undefined,
      { title: "5-minute reset", minutes: 5, attribute: "vitality" },
      momentum < config.recoveryMomentumFloor
        ? "Momentum is low. The smallest real action restarts it."
        : "You logged a miss recently — this restarts the loop without pressure.",
      { recovery: true, difficulty: "trivial" },
    );
  }

  const byCategory = (category: string) => boosts.find((b) => b.category === category);

  push(
    "recommended",
    byCategory("movement"),
    { title: "15-minute walk", minutes: 15, attribute: "vitality" },
    energy <= 2
      ? "Low energy responds better to movement than to focus work."
      : "Movement is the cheapest way to raise Momentum right now.",
  );

  push(
    "productive",
    byCategory("work") ?? byCategory("project"),
    { title: "20-minute focus session", minutes: 20, attribute: "focus" },
    available >= 20
      ? "You have the time window for one clean focus block."
      : "Short window — one compressed block still counts.",
  );

  push(
    "learn",
    byCategory("learning"),
    { title: "15-minute learning session", minutes: 15, attribute: "knowledge" },
    "Consistent small study sessions outperform rare long ones.",
  );

  push(
    "create",
    byCategory("creative") ?? byCategory("project"),
    { title: "Work on a hobby", minutes: 25, attribute: "creativity" },
    "Creative work is the strongest replacement for passive entertainment.",
  );

  // Wildcard is deterministic per seed so a screen render never reshuffles.
  const wildcardPool = boosts.length
    ? boosts
    : [
        { name: "Step outside and walk a new route", durationMinutes: 20, category: "outdoors" },
        { name: "Tidy one surface completely", durationMinutes: 10, category: "home" },
        { name: "Message someone you owe a reply", durationMinutes: 5, category: "social" },
        { name: "Learn one new thing and write it down", durationMinutes: 15, category: "learning" },
      ].map((x, i) => ({
        id: `fallback_${i}`,
        name: x.name,
        icon: "sparkles",
        category: x.category,
        difficulty: "normal" as Difficulty,
        durationMinutes: x.durationMinutes,
        frequency: "occasional",
        sparkReward: 0,
        attribute: CATEGORY_ATTRIBUTES[x.category] ?? "exploration",
        preferredTime: "any",
        minimumVersion: "",
        replacesDrainId: null,
        destinationId: null,
        createdAt: new Date(0).toISOString(),
      }));

  const wildcard = wildcardPool[Math.abs(seed) % wildcardPool.length]!;
  push(
    "wildcard",
    wildcard,
    { title: "Surprise me", minutes: 15, attribute: "exploration" },
    "Unexpected activity breaks a stale pattern.",
    { rush: momentum >= 40 },
  );

  return candidates.slice(0, 5);
}

export function optionToDraft(option: NextMoveOption): QuestDraft {
  return {
    name: option.title,
    description: option.reason,
    category: option.category,
    ...(option.rush ? { type: "rush" as const } : {}),
    durationMinutes: option.durationMinutes,
    difficulty: option.difficulty,
    attribute: option.attribute,
    destinationId: option.destinationId,
    boostId: option.boostId,
    isRecovery: option.isRecovery,
    createdBy: option.source === "ai" ? "ai" : "engine",
    aiGenerated: option.source === "ai",
  };
}