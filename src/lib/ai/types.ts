import type { MissAnalysisContext } from "../game/behavior-engine";
import type { PersonalContext } from "./personal-context-service";
import type {
  BehaviorAnalysisResponse,
  ChatAnswer,
  AdvisorResponse,
  ChangeRelevanceResponse,
  EventResponse,
  GoalPlanResponse,
  MissAnalysisResponse,
  NextMoveResponse,
  QuestResponse,
} from "./schemas";

/**
 * AIProvider — the only AI surface the rest of the app knows about.
 *
 * Hard rule: providers only ever PROPOSE. Deterministic engines validate and
 * apply. An AI response can never mutate Sparks, Rank, Momentum, Runs, Combos,
 * rewards, trophies, quest state, goal state or permanent rules.
 */

export type ProviderId = "phone_local" | "ollama" | "cloud";

export const PROVIDER_IDS: ProviderId[] = ["phone_local", "ollama", "cloud"];

export type ProviderStatus =
  | "disabled"
  | "not_configured"
  | "not_connected"
  | "testing"
  | "connected"
  | "error"
  | "rate_limited";

export const PROVIDER_STATUS_LABELS: Record<ProviderStatus, string> = {
  disabled: "Disabled",
  not_configured: "Not Configured",
  not_connected: "Not Connected",
  testing: "Testing",
  connected: "Connected",
  error: "Error",
  rate_limited: "Rate Limited",
};

export interface ProviderState {
  id: ProviderId;
  label: string;
  status: ProviderStatus;
  model: string | null;
  models: string[];
  detail: string;
  testedAt: string | null;
}

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly status: ProviderStatus,
    message: string,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export class ProviderRequestError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly status: ProviderStatus,
    message: string,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly label: string;
  getState(): ProviderState;
  testConnection(): Promise<ProviderState>;
  listModels(): Promise<string[]>;

  chat(messages: ChatMessage[], context: PersonalContext): Promise<ChatAnswer>;
  analyzeBehavior(context: PersonalContext): Promise<BehaviorAnalysisResponse>;
  analyzeMissedQuest(
    input: MissAnalysisContext,
    context: PersonalContext,
  ): Promise<MissAnalysisResponse>;
  generateNextMove(context: PersonalContext): Promise<NextMoveResponse>;
  generateQuest(intent: string, context: PersonalContext): Promise<QuestResponse>;
  generateEvent(intent: string, context: PersonalContext): Promise<EventResponse>;
  generateGoalPlan(rawInput: string, context: PersonalContext): Promise<GoalPlanResponse>;
  generateRecovery(context: PersonalContext): Promise<QuestResponse>;
  analyzeHistory(context: PersonalContext): Promise<BehaviorAnalysisResponse>;
  /** Phase 4A — interprets deterministically detected situations. */
  advise(
    situations: {
      code: string;
      label: string;
      detail: string;
      facts: string[];
      observations: string[];
    }[],
    context: PersonalContext,
  ): Promise<AdvisorResponse>;
  /** Phase 4A — semantic relevance check for a proven material change. */
  assessChange(
    advice: { title: string; summary: string; expectedOutcome: string },
    changes: { label: string; detail: string }[],
    context: PersonalContext,
  ): Promise<ChangeRelevanceResponse>;
}
