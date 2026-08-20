import { DEFAULT_ECONOMY } from "../game/config";
import type { BlueprintProposal } from "../game/blueprint-parser";
import { newId } from "../game/quest-engine";
import {
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type AttributeProgress,
  type Boost,
  type Destination,
  type Difficulty,
  type Drain,
  type Milestone,
  type Profile,
  type Settings,
} from "../game/types";

export function createDeviceId(): string {
  return `dev_${Math.random().toString(36).slice(2, 10)}`;
}

export function createProfile(nowIso: string): Profile {
  return {
    id: "profile",
    displayName: "Player One",
    title: "Newcomer",
    avatarSeed: "aurora",
    sparks: 0,
    lifetimeSparks: 0,
    rank: 1,
    chapter: "Chapter I — Ignition",
    currentRun: 0,
    bestRun: 0,
    lastActiveDay: null,
    combo: 0,
    comboUpdatedAt: null,
    createdAt: nowIso,
  };
}

export function createSettings(deviceId: string): Settings {
  return {
    id: "settings",
    deviceId,
    onboardingComplete: false,
    theme: "dark",
    reducedMotion: false,
    sound: true,
    economy: { ...DEFAULT_ECONOMY },
    ai: {
      mode: "auto",
      phoneLocal: {
        enabled: false,
        endpoint: "",
        model: "",
        apiKey: "",
        availableModels: [],
        lastTestedAt: null,
      },
      ollama: {
        enabled: false,
        endpoint: "http://localhost:11434",
        model: "",
        apiKey: "",
        availableModels: [],
        lastTestedAt: null,
      },
      cloud: {
        enabled: false,
        provider: "",
        endpoint: "https://api.openai.com/v1",
        model: "",
        apiKey: "",
        dailyLimit: 50,
        requestsToday: 0,
        requestsDay: "",
        availableModels: [],
        lastTestedAt: null,
      },
      jobBrains: {
        chat: "auto",
        analysis: "auto",
        quest: "auto",
        event: "auto",
        planning: "auto",
      },
      cloudFallback: true,
      advancedRouting: false,
    },
  };
}

export function createAttributes(): AttributeProgress[] {
  return ATTRIBUTE_KEYS.map((key) => ({ id: key, points: 0 }));
}

interface BoostTemplate {
  name: string;
  icon: string;
  category: string;
  minutes: number;
  difficulty: Difficulty;
  attribute: AttributeKey;
  preferredTime: string;
  minimumVersion: string;
}

const BOOST_TEMPLATES: Record<string, BoostTemplate> = {
  movement: {
    name: "Walk outside",
    icon: "footprints",
    category: "movement",
    minutes: 20,
    difficulty: "easy",
    attribute: "vitality",
    preferredTime: "morning",
    minimumVersion: "Walk to the end of the street and back",
  },
  learning: {
    name: "Study session",
    icon: "book-open",
    category: "learning",
    minutes: 25,
    difficulty: "normal",
    attribute: "knowledge",
    preferredTime: "afternoon",
    minimumVersion: "Read one page",
  },
  work: {
    name: "Focus block",
    icon: "target",
    category: "work",
    minutes: 30,
    difficulty: "hard",
    attribute: "focus",
    preferredTime: "morning",
    minimumVersion: "Open the task and work 5 minutes",
  },
  project: {
    name: "Project work",
    icon: "hammer",
    category: "project",
    minutes: 45,
    difficulty: "hard",
    attribute: "craft",
    preferredTime: "evening",
    minimumVersion: "Make one small commit or change",
  },
  creative: {
    name: "Hobby time",
    icon: "palette",
    category: "creative",
    minutes: 30,
    difficulty: "normal",
    attribute: "creativity",
    preferredTime: "evening",
    minimumVersion: "Set up your tools and start",
  },
  outdoors: {
    name: "Explore somewhere new",
    icon: "compass",
    category: "outdoors",
    minutes: 40,
    difficulty: "normal",
    attribute: "exploration",
    preferredTime: "weekend",
    minimumVersion: "Take a different route home",
  },
  social: {
    name: "Reach out to someone",
    icon: "message-circle",
    category: "social",
    minutes: 10,
    difficulty: "easy",
    attribute: "connection",
    preferredTime: "evening",
    minimumVersion: "Send one message",
  },
  home: {
    name: "Reset your space",
    icon: "sparkles",
    category: "home",
    minutes: 15,
    difficulty: "easy",
    attribute: "order",
    preferredTime: "evening",
    minimumVersion: "Clear one surface",
  },
};

export function createBoosts(categories: string[], nowIso: string): Boost[] {
  const unique = [...new Set(categories)];
  const chosen = unique.length ? unique : ["movement", "learning", "work"];
  return chosen
    .map((category) => BOOST_TEMPLATES[category])
    .filter((t): t is BoostTemplate => Boolean(t))
    .map((template) => ({
      id: newId("boost"),
      name: template.name,
      icon: template.icon,
      category: template.category,
      difficulty: template.difficulty,
      durationMinutes: template.minutes,
      frequency: "daily",
      sparkReward: 0,
      attribute: template.attribute,
      preferredTime: template.preferredTime,
      minimumVersion: template.minimumVersion,
      replacesDrainId: null,
      destinationId: null,
      createdAt: nowIso,
    }));
}

const DRAIN_TEMPLATES: Record<string, Omit<Drain, "id" | "createdAt">> = {
  "Unplanned gaming": {
    name: "Unplanned gaming",
    trigger: "Boredom or avoiding a hard task",
    frequency: "Most days",
    context: "At the desk, evening, nothing scheduled",
    typicalTime: "Evening",
    intensity: 4,
    consequence: "Hours disappear and the evening is gone",
    replacement: "Walk outside",
    counterMoveMinutes: 5,
    counterMoveAttribute: "vitality",
  },
  Doomscrolling: {
    name: "Doomscrolling",
    trigger: "Picking up the phone with no purpose",
    frequency: "Several times a day",
    context: "In bed, on the sofa, between tasks",
    typicalTime: "Morning and late night",
    intensity: 3,
    consequence: "Attention scattered, mood flattened",
    replacement: "Reset your space",
    counterMoveMinutes: 5,
    counterMoveAttribute: "order",
  },
  "Unplanned watching": {
    name: "Unplanned watching",
    trigger: "Wanting to switch off after effort",
    frequency: "Most evenings",
    context: "Sofa, autoplay running",
    typicalTime: "Night",
    intensity: 3,
    consequence: "Late sleep, slow next morning",
    replacement: "Hobby time",
    counterMoveMinutes: 10,
    counterMoveAttribute: "creativity",
  },
  "Aimless drifting": {
    name: "Aimless drifting",
    trigger: "No clear next action",
    frequency: "Daily",
    context: "Unstructured hours",
    typicalTime: "Afternoon",
    intensity: 3,
    consequence: "The day passes without a single chosen action",
    replacement: "Walk outside",
    counterMoveMinutes: 5,
    counterMoveAttribute: "vitality",
  },
  "Late-night drift": {
    name: "Late-night drift",
    trigger: "Not wanting the day to end",
    frequency: "Several nights a week",
    context: "After midnight, screens on",
    typicalTime: "Late night",
    intensity: 4,
    consequence: "Sleep debt kills the next day",
    replacement: "Reset your space",
    counterMoveMinutes: 5,
    counterMoveAttribute: "order",
  },
};

export function createDrains(names: string[], nowIso: string): Drain[] {
  const chosen = names.length ? names : ["Aimless drifting"];
  return chosen
    .map((name) => DRAIN_TEMPLATES[name])
    .filter((t): t is Omit<Drain, "id" | "createdAt"> => Boolean(t))
    .map((template) => ({ ...template, id: newId("drain"), createdAt: nowIso }));
}

export function createDestination(
  proposal: BlueprintProposal,
  nowIso: string,
): { destination: Destination; milestones: Milestone[] } {
  const attributes = proposal.attributes.length ? proposal.attributes : (["vitality"] as AttributeKey[]);
  const destination: Destination = {
    id: newId("dest"),
    title: proposal.goals[0] ?? "Build a consistent week",
    description: proposal.direction,
    priority: 1,
    attributes,
    progress: 0,
    status: "active",
    isBoss: false,
    bossMaxHp: 100,
    bossHp: 100,
    createdAt: nowIso,
  };
  const milestones: Milestone[] = ["First real action", "Three days in a row", "One full week"].map(
    (title) => ({
      id: newId("ms"),
      destinationId: destination.id,
      title,
      done: false,
      createdAt: nowIso,
    }),
  );
  return { destination, milestones };
}