import type { AttributeKey, Difficulty, PersonalBlueprint } from "./types";

/**
 * Deterministic Personal Blueprint parser.
 *
 * This is the *fallback* interpreter used while no AI brain is connected.
 * The AIProvider.generateGoalPlan operation returns the same shape, so the
 * approval workflow is identical either way. Nothing is ever activated
 * without the user pressing APPROVE.
 */

interface Signal {
  keywords: string[];
  goal: string;
  priority: string;
  attribute: AttributeKey;
  boostCategory: string;
}

const SIGNALS: Signal[] = [
  {
    keywords: ["active", "fit", "exercise", "gym", "walk", "run", "movement", "energetic", "health"],
    goal: "Move my body every day",
    priority: "Physical activity",
    attribute: "vitality",
    boostCategory: "movement",
  },
  {
    keywords: ["study", "learn", "course", "read", "language", "school", "exam", "coding", "skill"],
    goal: "Study consistently instead of in bursts",
    priority: "Learning",
    attribute: "knowledge",
    boostCategory: "learning",
  },
  {
    keywords: ["productive", "work", "focus", "deep work", "job", "career", "procrastinat"],
    goal: "Do focused work without stalling",
    priority: "Productive work",
    attribute: "focus",
    boostCategory: "work",
  },
  {
    keywords: ["project", "build", "make", "craft", "ship", "portfolio"],
    goal: "Finish a personal project",
    priority: "Personal projects",
    attribute: "craft",
    boostCategory: "project",
  },
  {
    keywords: ["hobby", "creative", "music", "draw", "write", "art", "interesting"],
    goal: "Spend real time on hobbies",
    priority: "Creative time",
    attribute: "creativity",
    boostCategory: "creative",
  },
  {
    keywords: ["outside", "outdoor", "explore", "travel", "nature", "adventure"],
    goal: "Get outside and explore more",
    priority: "Exploration",
    attribute: "exploration",
    boostCategory: "outdoors",
  },
  {
    keywords: ["friend", "family", "social", "people", "connect", "lonely"],
    goal: "Stay connected with people who matter",
    priority: "Connection",
    attribute: "connection",
    boostCategory: "social",
  },
  {
    keywords: ["clean", "tidy", "organis", "organiz", "chore", "room", "responsib", "routine"],
    goal: "Keep my space and routines in order",
    priority: "Personal responsibility",
    attribute: "order",
    boostCategory: "home",
  },
];

const ANTI_SIGNALS: { keywords: string[]; antiGoal: string; drain: string }[] = [
  {
    keywords: ["gaming", "game", "games", "console", "steam"],
    antiGoal: "Long unplanned gaming sessions",
    drain: "Unplanned gaming",
  },
  {
    keywords: ["scroll", "social media", "tiktok", "instagram", "reels", "phone"],
    antiGoal: "Endless scrolling",
    drain: "Doomscrolling",
  },
  {
    keywords: ["youtube", "netflix", "binge", "series", "tv", "stream"],
    antiGoal: "Unplanned binge-watching",
    drain: "Unplanned watching",
  },
  {
    keywords: ["passive", "lazy", "procrastinat", "nothing", "waste"],
    antiGoal: "Drifting through the day with no plan",
    drain: "Aimless drifting",
  },
  {
    keywords: ["late", "sleep", "night", "insomnia"],
    antiGoal: "Losing the evening and sleeping late",
    drain: "Late-night drift",
  },
];

const MOTIVATORS: { keywords: string[]; motivator: string }[] = [
  { keywords: ["progress", "level", "grow", "better"], motivator: "Visible progress" },
  { keywords: ["energ", "feel", "mood", "confiden"], motivator: "Feeling better day to day" },
  { keywords: ["reward", "fun", "game", "loot"], motivator: "Earning rewards I actually want" },
  { keywords: ["consist", "habit", "routine", "discipl"], motivator: "Being someone consistent" },
  { keywords: ["project", "finish", "complete", "ship"], motivator: "Finishing what I start" },
];

export interface BlueprintProposal {
  direction: string;
  goals: string[];
  priorities: string[];
  motivators: string[];
  preferredDifficulty: Difficulty;
  preferredQuestStyle: string;
  constraints: string[];
  antiGoals: string[];
  rewardPreferences: string[];
  behaviorStrategy: string;
  attributes: AttributeKey[];
  boostCategories: string[];
  drainNames: string[];
}

function has(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

/** `variant` lets REGENERATE produce a different phrasing deterministically. */
export function proposeBlueprint(rawInput: string, variant = 0): BlueprintProposal {
  const text = rawInput.toLowerCase();

  const matched = SIGNALS.filter((s) => has(text, s.keywords));
  const active = matched.length ? matched : SIGNALS.slice(0, 3);

  const antiMatched = ANTI_SIGNALS.filter((s) => has(text, s.keywords));
  const anti = antiMatched.length ? antiMatched : [ANTI_SIGNALS[3]!];

  const motivators = MOTIVATORS.filter((m) => has(text, m.keywords)).map((m) => m.motivator);

  const constraints: string[] = [];
  if (has(text, ["still keep entertainment", "keep entertainment", "not quit", "still play", "balance"])) {
    constraints.push("Entertainment stays — it gets planned, not removed");
  }
  if (has(text, ["tired", "low energy", "exhaust", "burn"])) {
    constraints.push("Energy is often low — quests must scale down");
  }
  if (has(text, ["busy", "no time", "work", "school", "study"])) {
    constraints.push("Time windows are limited on weekdays");
  }
  if (has(text, ["short", "small", "quick", "minutes"])) {
    constraints.push("Prefers short sessions over long ones");
  }
  if (constraints.length === 0) constraints.push("Start small; scale only after consistency appears");

  const wantsHard = has(text, ["hard", "push", "intense", "serious", "aggressive"]);
  const wantsEasy = has(text, ["easy", "gentle", "slow", "tired", "overwhelm"]);
  const preferredDifficulty: Difficulty = wantsHard ? "hard" : wantsEasy ? "easy" : "normal";

  const styles = [
    "Short quests with a clear finish line, chained into Combos",
    "One meaningful Battle per day, plus optional bonus rounds",
    "Frequent Quick Quests with occasional Focus blocks",
  ];

  const directions = [
    "Trade passive time for real activity, and make progress visible every single day.",
    "Become the version of you that moves, learns and builds — in small reliable steps.",
    "Replace drift with direction: fewer default hours, more chosen ones.",
  ];

  const rewardPreferences = ["Planned entertainment time", "Hobby time", "Cosmetic and title unlocks"];

  return {
    direction: directions[variant % directions.length]!,
    goals: active.map((s) => s.goal),
    priorities: active.slice(0, 4).map((s) => s.priority),
    motivators: motivators.length ? motivators : ["Visible progress", "Feeling better day to day"],
    preferredDifficulty,
    preferredQuestStyle: styles[variant % styles.length]!,
    constraints,
    antiGoals: anti.map((a) => a.antiGoal),
    rewardPreferences,
    behaviorStrategy:
      "Interrupt the trigger, offer a small replacement immediately, reward the action, repeat until it is the default.",
    attributes: active.map((s) => s.attribute),
    boostCategories: active.map((s) => s.boostCategory),
    drainNames: anti.map((a) => a.drain),
  };
}

export function proposalToBlueprint(
  rawInput: string,
  proposal: BlueprintProposal,
  nowIso: string,
): PersonalBlueprint {
  return {
    id: "blueprint",
    rawInput,
    direction: proposal.direction,
    goals: proposal.goals,
    priorities: proposal.priorities,
    motivators: proposal.motivators,
    preferredDifficulty: proposal.preferredDifficulty,
    preferredQuestStyle: proposal.preferredQuestStyle,
    constraints: proposal.constraints,
    antiGoals: proposal.antiGoals,
    rewardPreferences: proposal.rewardPreferences,
    behaviorStrategy: proposal.behaviorStrategy,
    approved: false,
    generatedBy: "engine",
    createdAt: nowIso,
    approvedAt: null,
  };
}