/**
 * Core domain model for the Personal Life RPG.
 * These types are storage-agnostic: the same shapes are used by the IndexedDB
 * repository today and by a native SQLite repository after export.
 */

import type { TrustGrant } from "../advisor/action-trust";
import type { TimeWindow, WindowStatus } from "./time-window";



export const SCHEMA_VERSION = 1;

export type AttributeKey =
  | "vitality"
  | "knowledge"
  | "focus"
  | "craft"
  | "exploration"
  | "connection"
  | "creativity"
  | "order";

export const ATTRIBUTE_KEYS: AttributeKey[] = [
  "vitality",
  "knowledge",
  "focus",
  "craft",
  "exploration",
  "connection",
  "creativity",
  "order",
];

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  vitality: "Vitality",
  knowledge: "Knowledge",
  focus: "Focus",
  craft: "Craft",
  exploration: "Exploration",
  connection: "Connection",
  creativity: "Creativity",
  order: "Order",
};

export type Difficulty = "trivial" | "easy" | "normal" | "hard" | "extreme";

export const DIFFICULTIES: Difficulty[] = ["trivial", "easy", "normal", "hard", "extreme"];

export type QuestType = "quick" | "normal" | "focus" | "rush" | "epic" | "wildcard";

export const QUEST_TYPE_LABELS: Record<QuestType, string> = {
  quick: "Quick Quest",
  normal: "Normal Quest",
  focus: "Focus Quest",
  rush: "Rush Quest",
  epic: "Epic Quest",
  wildcard: "Wildcard",
};

export type QuestStatus = "available" | "active" | "completed" | "missed" | "archived";

export type VerificationStatus = "verified" | "self_reported" | "evidence" | "unverified";

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  verified: "Verified",
  self_reported: "Self-reported",
  evidence: "Evidence-based",
  unverified: "Unverified",
};

export type CreatedBy = "user" | "engine" | "ai";

export type NextMoveCategory =
  | "recommended"
  | "productive"
  | "learn"
  | "create"
  | "recovery"
  | "wildcard";

export interface Profile {
  id: "profile";
  displayName: string;
  title: string;
  avatarSeed: string;
  sparks: number;
  lifetimeSparks: number;
  rank: number;
  chapter: string;
  currentRun: number;
  bestRun: number;
  lastActiveDay: string | null;
  combo: number;
  comboUpdatedAt: string | null;
  createdAt: string;
}

export interface PersonalBlueprint {
  id: "blueprint";
  rawInput: string;
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
  approved: boolean;
  generatedBy: CreatedBy;
  createdAt: string;
  approvedAt: string | null;
  /** Last local edit — the touch time live sync and the conflict engine compare. */
  updatedAt?: string;
}

export type DestinationStatus =
  | "proposed"
  | "active"
  | "paused"
  | "revised"
  | "completed"
  | "abandoned";

export interface Destination {
  id: string;
  title: string;
  description: string;
  priority: number;
  attributes: AttributeKey[];
  progress: number;
  status: DestinationStatus;
  isBoss: boolean;
  bossMaxHp: number;
  bossHp: number;
  createdAt: string;
}

export interface Milestone {
  id: string;
  destinationId: string;
  title: string;
  done: boolean;
  createdAt: string;
}

export interface Boost {
  id: string;
  name: string;
  icon: string;
  category: string;
  difficulty: Difficulty;
  durationMinutes: number;
  frequency: string;
  sparkReward: number;
  attribute: AttributeKey;
  preferredTime: string;
  minimumVersion: string;
  replacesDrainId: string | null;
  destinationId: string | null;
  createdAt: string;
}

export interface Drain {
  id: string;
  name: string;
  trigger: string;
  frequency: string;
  context: string;
  typicalTime: string;
  intensity: number;
  consequence: string;
  replacement: string;
  counterMoveMinutes: number;
  counterMoveAttribute: AttributeKey;
  createdAt: string;
}

export interface Quest {
  id: string;
  name: string;
  description: string;
  category: string;
  type: QuestType;
  durationMinutes: number;
  difficulty: Difficulty;
  sparks: number;
  attribute: AttributeKey;
  destinationId: string | null;
  boostId: string | null;
  scheduledFor: string | null;
  /** Optional part of the day this belongs to. Absent means anytime. */
  timeWindow?: TimeWindow | null;
  status: QuestStatus;
  verification: VerificationStatus;
  createdBy: CreatedBy;
  aiGenerated: boolean;
  approved: boolean;
  isRecovery: boolean;
  rushWindowSeconds: number | null;
  createdAt: string;
}

export type MissReason =
  | "too_tired"
  | "distracted"
  | "no_time"
  | "started_gaming"
  | "didnt_feel_like_it"
  | "too_difficult"
  | "too_boring"
  | "unclear"
  | "unexpected_event"
  | "other";

export const MISS_REASON_LABELS: Record<MissReason, string> = {
  too_tired: "Too tired",
  distracted: "Distracted",
  no_time: "No time",
  started_gaming: "Started gaming",
  didnt_feel_like_it: "Didn't feel like it",
  too_difficult: "Too difficult",
  too_boring: "Too boring",
  unclear: "Unclear",
  unexpected_event: "Unexpected event",
  other: "Other",
};

export interface QuestRun {
  id: string;
  questId: string;
  questName: string;
  startedAt: string;
  endedAt: string | null;
  outcome: "in_progress" | "completed" | "missed";
  verification: VerificationStatus;
  sparksAwarded: number;
  comboAtCompletion: number;
  rushRequested: boolean;
  rushHit: boolean | null;
  missReason: MissReason | null;
  missNote: string | null;
  energyAtStart: number | null;
  moodAtStart: number | null;
  momentumAtStart: number | null;
  /** Part of the day this run actually started in. */
  windowAtStart?: TimeWindow | null;
  /** Whether it started inside its own window. Never affects rewards. */
  windowStatus?: WindowStatus | null;
  /** Set when this run came from recovering an earlier miss. */
  recoveryOfRunId?: string | null;
}

export interface DailyState {
  id: string; // YYYY-MM-DD
  energy: number; // 1-5
  mood: number; // 1-5
  availableMinutes: number;
  note: string;
  updatedAt: string;
  /** First time Today was opened on this day. */
  openedAt?: string | null;
  /** Set when the player closed the day. */
  closedAt?: string | null;
}

export type ActivityEventType =
  | "quest_completed"
  | "quest_missed"
  | "quest_started"
  | "boost_logged"
  | "drain_logged"
  | "recovery_completed"
  | "trophy_earned"
  | "rank_up"
  | "blueprint_approved";

export interface ActivityEvent {
  id: string;
  deviceId: string;
  timestamp: string;
  type: ActivityEventType;
  schemaVersion: number;
  payload: Record<string, unknown>;
}

export interface AttributeProgress {
  id: AttributeKey;
  points: number;
}

export interface Trophy {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string;
}

export interface AiProviderSettings {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
  /** Free-text provider name (online API only, e.g. "OpenAI-compatible"). */
  provider?: string;
  /** 0 = no limit. Enforced before any request leaves the device. */
  dailyLimit?: number;
  requestsDay?: string;
  requestsToday?: number;
  /** Result of the last real handshake — never assumed, only recorded. */
  lastStatus?: "not_connected" | "connected" | "error" | "rate_limited";
  lastDetail?: string;
  lastTestedAt?: string | null;
  availableModels?: string[];
}

export type AiMode = "auto" | "phone_local" | "ollama" | "cloud" | "off";

export type AiJob = "chat" | "analysis" | "quest" | "event" | "planning";

export interface Settings {
  id: "settings";
  deviceId: string;
  onboardingComplete: boolean;
  theme: "dark" | "light";
  reducedMotion: boolean;
  sound: boolean;
  economy: EconomyConfig;
  ai: {
    mode: AiMode;
    phoneLocal: AiProviderSettings;
    ollama: AiProviderSettings;
    cloud: AiProviderSettings & { provider: string };
    jobBrains: Record<AiJob, AiMode>;
    /** Allow the cloud provider as a fallback when local brains fail. */
    cloudFallback?: boolean;
    /** Per-job brains only apply when this is on. */
    advancedRouting?: boolean;
  };
  /** Action types you chose to streamline. Revocable; never includes high-impact. */
  trustedActions?: TrustGrant[];
  /** Device-local rhythm prompts. Off by default and never synced. */
  rhythm?: {
    reentryEnabled: boolean;
    slots: TimeWindow[];
    lastPromptedDay: string | null;
  };
  /** Last local edit — the touch time live sync and the conflict engine compare. */
  updatedAt?: string;
}


export interface EconomyConfig {
  baseSparksPerMinute: number;
  difficultyMultiplier: Record<Difficulty, number>;
  comboBonusPerStep: number;
  comboMaxMultiplier: number;
  surgeThreshold: number;
  surgeBonusSparks: number;
  comboWindowMinutes: number;
  rankCurveBase: number;
  rankCurveGrowth: number;
  runGraceDays: number;
  momentumDecayPerHour: number;
  momentumPerCompletion: number;
  momentumMissPenalty: number;
  recoveryMomentumFloor: number;
  attributePointsPerQuest: number;
}

export interface GameSnapshot {
  profile: Profile;
  settings: Settings;
  blueprint: PersonalBlueprint | null;
  destinations: Destination[];
  milestones: Milestone[];
  boosts: Boost[];
  drains: Drain[];
  quests: Quest[];
  questRuns: QuestRun[];
  dailyStates: DailyState[];
  events: ActivityEvent[];
  attributes: AttributeProgress[];
  trophies: Trophy[];
}