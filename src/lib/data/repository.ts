import type {
  ActivityEvent,
  AttributeProgress,
  Boost,
  DailyState,
  Destination,
  Drain,
  GameSnapshot,
  Milestone,
  PersonalBlueprint,
  Profile,
  Quest,
  QuestRun,
  Settings,
  Trophy,
} from "../game/types";
import type { ChatTurn, Conversation, MemoryLinkRecord, MemoryRecord, ProposalRecord } from "../ai/records";
import type {
  DecisionFeedbackRecord,
  RecommendationHistoryRecord,
  RecommendationOutcomeRecord,
  RecommendationRecord,
} from "../advisor/advisor-types";
import type {
  ActionRecordRow,
  AgentFeedbackRecord,
  AgentOutcomeRecord,
  AgentRunRecord,
  PlanRecord,
  TaskRecord,
} from "../agent/agent-types";
import type {
  BackupMetaRecord,
  ConflictRecord,
  DriveFileRecord,
  ProcessedEvent,
  SyncEvent,
  SyncStateRecord,
} from "../sync/types";

/**
 * LocalRepository — the single storage boundary of the app.
 *
 * No component, screen or engine touches a database directly. The Lovable web
 * build ships an IndexedDB implementation; a native SQLite implementation can
 * be dropped in after export (Capacitor / Android) without touching UI code.
 */

export interface StoreMap {
  profile: Profile;
  blueprint: PersonalBlueprint;
  settings: Settings;
  destinations: Destination;
  milestones: Milestone;
  boosts: Boost;
  drains: Drain;
  quests: Quest;
  questRuns: QuestRun;
  dailyStates: DailyState;
  events: ActivityEvent;
  attributes: AttributeProgress;
  trophies: Trophy;
  /* Phase 2 — AI side records. Never authoritative game state. */
  conversations: Conversation;
  chatMessages: ChatTurn;
  memories: MemoryRecord;
  /* Phase 4B — typed edges between memories and game/advisor records. */
  memoryLinks: MemoryLinkRecord;
  proposals: ProposalRecord;
  /* Phase 3 — Drive vault sync. The local DB stays the source of truth. */
  syncEvents: SyncEvent;
  processedEvents: ProcessedEvent;
  syncState: SyncStateRecord;
  conflicts: ConflictRecord;
  backupMeta: BackupMetaRecord;
  driveFiles: DriveFileRecord;
  /* Phase 4A — AI Life/Game Advisor. Proposals + measured outcomes, never game state. */
  recommendations: RecommendationRecord;
  recommendationOutcomes: RecommendationOutcomeRecord;
  recommendationHistory: RecommendationHistoryRecord;
  decisionFeedback: DecisionFeedbackRecord;
  /* Phase 4C — Agent planner/orchestrator. Plans and audit records, never game state. */
  agentRuns: AgentRunRecord;
  plans: PlanRecord;
  tasks: TaskRecord;
  actionRecords: ActionRecordRow;
  agentOutcomes: AgentOutcomeRecord;
  agentFeedback: AgentFeedbackRecord;
  /* Reserved for later phases — tables exist, screens do not yet. */
  rewards: { id: string } & Record<string, unknown>;
  chapters: { id: string } & Record<string, unknown>;
  experiments: { id: string } & Record<string, unknown>;
  behaviorPatterns: { id: string } & Record<string, unknown>;
  conversationMemory: { id: string } & Record<string, unknown>;
  aiAnalyses: { id: string } & Record<string, unknown>;
}

export type StoreName = keyof StoreMap;

export const STORE_NAMES: StoreName[] = [
  "profile",
  "blueprint",
  "settings",
  "destinations",
  "milestones",
  "boosts",
  "drains",
  "quests",
  "questRuns",
  "dailyStates",
  "events",
  "attributes",
  "trophies",
  "conversations",
  "chatMessages",
  "memories",
  "memoryLinks",
  "proposals",
  "syncEvents",
  "processedEvents",
  "syncState",
  "conflicts",
  "backupMeta",
  "driveFiles",
  "recommendations",
  "recommendationOutcomes",
  "recommendationHistory",
  "decisionFeedback",
  "agentRuns",
  "plans",
  "tasks",
  "actionRecords",
  "agentOutcomes",
  "agentFeedback",
  "rewards",
  "chapters",
  "experiments",
  "behaviorPatterns",
  "conversationMemory",
  "aiAnalyses",
];

export interface LocalRepository {
  readonly kind: string;
  init(): Promise<void>;
  list<K extends StoreName>(store: K): Promise<StoreMap[K][]>;
  get<K extends StoreName>(store: K, id: string): Promise<StoreMap[K] | null>;
  put<K extends StoreName>(store: K, value: StoreMap[K]): Promise<void>;
  putMany<K extends StoreName>(store: K, values: StoreMap[K][]): Promise<void>;
  remove(store: StoreName, id: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
  clearAll(): Promise<void>;
  loadSnapshot(): Promise<GameSnapshot | null>;
  exportAll(): Promise<Record<string, unknown[]>>;
  importAll(data: Record<string, unknown[]>): Promise<void>;
}