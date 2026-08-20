import type { AiProviderSettings } from "../game/types";
import type { MissAnalysisContext } from "../game/behavior-engine";
import type { PersonalContext } from "./personal-context-service";
import {
  behaviorAnalysisSchema,
  advisorSchema,
  changeRelevanceSchema,
  chatAnswerSchema,
  eventSchema,
  goalPlanSchema,
  missAnalysisSchema,
  nextMoveSchema,
  parseStructured,
  questSchema,
} from "./schemas";
import {
  SYSTEM_BASE,
  advisorPrompt,
  changeRelevancePrompt,
  behaviorPrompt,
  chatPrompt,
  eventPrompt,
  goalPlanPrompt,
  missPrompt,
  nextMovePrompt,
  questPrompt,
  recoveryPrompt,
} from "./prompts";
import {
  ProviderRequestError,
  ProviderUnavailableError,
  type AIProvider,
  type ChatMessage,
  type ProviderId,
  type ProviderState,
  type ProviderStatus,
} from "./types";

/**
 * Real transports. Nothing here fakes a connection: `connected` is only ever
 * reported after a successful handshake performed by testConnection().
 *
 * Requests run from the device (local-first): API keys never leave the device
 * and a local Ollama endpoint is only reachable from the device itself.
 */

const TEST_TIMEOUT_MS = 10_000;
/** Generous ceiling only — local models legitimately take minutes. */
const GENERATION_TIMEOUT_MS = 300_000;

export interface ProviderHooks {
  onState?: (id: ProviderId, patch: Partial<AiProviderSettings>) => void;
  onUsage?: (id: ProviderId) => void;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function normaliseBase(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  providerId: ProviderId,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "The request timed out."
        : "Could not reach the endpoint from this device (offline, wrong address, or blocked by the browser).";
    throw new ProviderRequestError(providerId, "not_connected", message);
  }
  if (response.status === 429) {
    throw new ProviderRequestError(providerId, "rate_limited", "The provider is rate limiting requests.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderRequestError(providerId, "error", "The provider rejected the credentials.");
  }
  if (!response.ok) {
    throw new ProviderRequestError(
      providerId,
      "error",
      `The provider returned ${response.status} ${response.statusText}.`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderRequestError(providerId, "error", "The provider returned a non-JSON response.");
  }
}

abstract class BaseProvider implements AIProvider {
  abstract readonly id: ProviderId;
  abstract readonly label: string;

  constructor(
    protected settings: AiProviderSettings,
    protected hooks: ProviderHooks = {},
  ) {}

  /** Everything the provider needs before it can be tested at all. */
  protected abstract requirement(): { ok: boolean; detail: string };

  protected abstract handshake(): Promise<string[]>;
  protected abstract complete(system: string, user: string, json: boolean): Promise<string>;

  getState(): ProviderState {
    const models = this.settings.availableModels ?? [];
    if (!this.settings.enabled) {
      return this.state("disabled", "Turned off in the AI Control Center.", models);
    }
    const requirement = this.requirement();
    if (!requirement.ok) return this.state("not_configured", requirement.detail, models);

    const stored = this.settings.lastStatus;
    if (stored === "connected") {
      return this.state("connected", "Connection test succeeded on this device.", models);
    }
    if (stored === "rate_limited") return this.state("rate_limited", "Rate limited.", models);
    if (stored === "error") {
      return this.state("error", this.settings.lastDetail || "The last request failed.", models);
    }
    return this.state("not_connected", "Configured — run Test Connection.", models);
  }

  protected state(status: ProviderStatus, detail: string, models: string[]): ProviderState {
    return {
      id: this.id,
      label: this.label,
      status,
      model: this.settings.model || null,
      models,
      detail,
      testedAt: this.settings.lastTestedAt ?? null,
    };
  }

  async testConnection(): Promise<ProviderState> {
    const current = this.getState();
    if (current.status === "disabled" || current.status === "not_configured") return current;
    try {
      const models = await this.handshake();
      this.settings = {
        ...this.settings,
        lastStatus: "connected",
        lastDetail: "",
        lastTestedAt: new Date().toISOString(),
        availableModels: models,
      };
      this.hooks.onState?.(this.id, {
        lastStatus: "connected",
        lastDetail: "",
        lastTestedAt: this.settings.lastTestedAt ?? null,
        availableModels: models,
      });
      return this.state("connected", "Connection test succeeded on this device.", models);
    } catch (error) {
      const status: ProviderStatus =
        error instanceof ProviderRequestError && error.status === "rate_limited"
          ? "rate_limited"
          : error instanceof ProviderRequestError && error.status === "error"
            ? "error"
            : "not_connected";
      const detail = error instanceof Error ? error.message : "Connection failed.";
      this.settings = { ...this.settings, lastStatus: status, lastDetail: detail, lastTestedAt: new Date().toISOString() };
      this.hooks.onState?.(this.id, {
        lastStatus: status,
        lastDetail: detail,
        lastTestedAt: this.settings.lastTestedAt ?? null,
      });
      return this.state(status, detail, this.settings.availableModels ?? []);
    }
  }

  async listModels(): Promise<string[]> {
    const models = await this.handshake();
    this.hooks.onState?.(this.id, { availableModels: models, lastStatus: "connected", lastDetail: "" });
    return models;
  }

  protected ensureReady(): void {
    const state = this.getState();
    if (state.status !== "connected") {
      throw new ProviderUnavailableError(
        this.id,
        state.status,
        `${this.label} is not connected. ${state.detail}`,
      );
    }
    const limit = this.settings.dailyLimit ?? 0;
    if (limit > 0) {
      const used = this.settings.requestsDay === todayKey() ? (this.settings.requestsToday ?? 0) : 0;
      if (used >= limit) {
        throw new ProviderUnavailableError(
          this.id,
          "rate_limited",
          `${this.label} hit today's request limit (${limit}).`,
        );
      }
    }
  }

  protected async ask(system: string, user: string): Promise<string> {
    this.ensureReady();
    this.hooks.onUsage?.(this.id);
    return this.complete(system, user, true);
  }

  async chat(messages: ChatMessage[], context: PersonalContext) {
    const history = messages
      .slice(-8, -1)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");
    const last = messages[messages.length - 1]?.content ?? "";
    const user = history ? `RECENT CONVERSATION:\n${history}\n\n${chatPrompt(context, last)}` : chatPrompt(context, last);
    return parseStructured(chatAnswerSchema, await this.ask(SYSTEM_BASE, user));
  }

  async analyzeBehavior(context: PersonalContext) {
    return parseStructured(behaviorAnalysisSchema, await this.ask(SYSTEM_BASE, behaviorPrompt(context)));
  }

  async analyzeMissedQuest(input: MissAnalysisContext, context: PersonalContext) {
    return parseStructured(missAnalysisSchema, await this.ask(SYSTEM_BASE, missPrompt(context, input)));
  }

  async generateNextMove(context: PersonalContext) {
    return parseStructured(nextMoveSchema, await this.ask(SYSTEM_BASE, nextMovePrompt(context)));
  }

  async generateQuest(intent: string, context: PersonalContext) {
    return parseStructured(questSchema, await this.ask(SYSTEM_BASE, questPrompt(context, intent)));
  }

  async generateEvent(intent: string, context: PersonalContext) {
    return parseStructured(eventSchema, await this.ask(SYSTEM_BASE, eventPrompt(context, intent)));
  }

  async generateGoalPlan(rawInput: string, context: PersonalContext) {
    return parseStructured(goalPlanSchema, await this.ask(SYSTEM_BASE, goalPlanPrompt(context, rawInput)));
  }

  async generateRecovery(context: PersonalContext) {
    return parseStructured(questSchema, await this.ask(SYSTEM_BASE, recoveryPrompt(context)));
  }

  async analyzeHistory(context: PersonalContext) {
    return this.analyzeBehavior(context);
  }

  async advise(
    situations: {
      code: string;
      label: string;
      detail: string;
      facts: string[];
      observations: string[];
    }[],
    context: PersonalContext,
  ) {
    return parseStructured(advisorSchema, await this.ask(SYSTEM_BASE, advisorPrompt(context, situations)));
  }

  async assessChange(
    advice: { title: string; summary: string; expectedOutcome: string },
    changes: { label: string; detail: string }[],
    context: PersonalContext,
  ) {
    return parseStructured(
      changeRelevanceSchema,
      await this.ask(SYSTEM_BASE, changeRelevancePrompt(context, advice, changes)),
    );
  }
}

/** Ollama native API (/api/tags, /api/chat). */
export class OllamaProvider extends BaseProvider {
  readonly id = "ollama" as const;
  readonly label = "Ollama";

  protected requirement() {
    if (!normaliseBase(this.settings.endpoint)) return { ok: false, detail: "No local endpoint set." };
    if (!this.settings.model) return { ok: false, detail: "No model selected yet." };
    return { ok: true, detail: "" };
  }

  protected async handshake(): Promise<string[]> {
    const base = normaliseBase(this.settings.endpoint) || "http://localhost:11434";
    const data = (await fetchJson(`${base}/api/tags`, { method: "GET" }, TEST_TIMEOUT_MS, this.id)) as {
      models?: { name?: string; model?: string }[];
    };
    return (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter(Boolean)
      .sort();
  }

  protected async complete(system: string, user: string, json: boolean): Promise<string> {
    const base = normaliseBase(this.settings.endpoint);
    const data = (await fetchJson(
      `${base}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.settings.model,
          stream: false,
          ...(json ? { format: "json" } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      },
      GENERATION_TIMEOUT_MS,
      this.id,
    )) as { message?: { content?: string } };
    const content = data.message?.content;
    if (!content) throw new ProviderRequestError(this.id, "error", "Empty response from the model.");
    return content;
  }
}

/** Generic OpenAI-compatible transport (/models, /chat/completions). */
class OpenAiCompatibleProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly label: string;

  constructor(
    id: ProviderId,
    label: string,
    settings: AiProviderSettings,
    hooks: ProviderHooks,
    private readonly needsKey: boolean,
  ) {
    super(settings, hooks);
    this.id = id;
    this.label = label;
  }

  protected requirement() {
    if (!normaliseBase(this.settings.endpoint)) return { ok: false, detail: "No base URL set." };
    if (this.needsKey && !this.settings.apiKey) {
      return { ok: false, detail: "No API key stored on this device." };
    }
    if (!this.settings.model) return { ok: false, detail: "No model selected yet." };
    return { ok: true, detail: "" };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.settings.apiKey) headers["Authorization"] = `Bearer ${this.settings.apiKey}`;
    return headers;
  }

  protected async handshake(): Promise<string[]> {
    const base = normaliseBase(this.settings.endpoint);
    const data = (await fetchJson(
      `${base}/models`,
      { method: "GET", headers: this.headers() },
      TEST_TIMEOUT_MS,
      this.id,
    )) as { data?: { id?: string }[] };
    return (data.data ?? [])
      .map((m) => m.id ?? "")
      .filter(Boolean)
      .sort();
  }

  protected async complete(system: string, user: string, json: boolean): Promise<string> {
    const base = normaliseBase(this.settings.endpoint);
    const data = (await fetchJson(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.settings.model,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      },
      GENERATION_TIMEOUT_MS,
      this.id,
    )) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new ProviderRequestError(this.id, "error", "Empty response from the model.");
    return content;
  }
}

/**
 * Phone-local runtime boundary. Any on-device runtime that exposes an
 * OpenAI-compatible HTTP surface can be pointed at here. With nothing
 * configured it honestly reports Not Configured — it never fakes availability.
 */
export class PhoneLocalProvider extends OpenAiCompatibleProvider {
  constructor(settings: AiProviderSettings, hooks: ProviderHooks = {}) {
    super("phone_local", "Phone Local", settings, hooks, false);
  }
}

export class OnlineApiProvider extends OpenAiCompatibleProvider {
  constructor(settings: AiProviderSettings, hooks: ProviderHooks = {}) {
    super("cloud", settings.provider ? `Online API · ${settings.provider}` : "Online API", settings, hooks, true);
  }
}
