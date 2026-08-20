import type { AiJob, AiMode, Settings } from "../game/types";
import { OllamaProvider, OnlineApiProvider, PhoneLocalProvider, type ProviderHooks } from "./providers";
import { MalformedAiResponseError } from "./schemas";
import { PROVIDER_IDS, type AIProvider, type ProviderId, type ProviderState } from "./types";

/**
 * AIRouter — resolves which brain handles a job and defines the fallback chain
 * that always terminates in the deterministic engine. The game never depends on
 * a live LLM.
 */

export const AI_MODE_LABELS: Record<AiMode, string> = {
  auto: "Auto",
  phone_local: "Phone Local",
  ollama: "Ollama",
  cloud: "Cloud",
  off: "AI Off",
};

export const AI_JOB_LABELS: Record<AiJob, string> = {
  chat: "Chat Brain",
  analysis: "Analysis Brain",
  quest: "Quest Brain",
  event: "Event Brain",
  planning: "Planning Brain",
};

export const DETERMINISTIC_LABEL = "Local game intelligence";

export interface AiOutcome<T> {
  value: T;
  source: "ai" | "engine";
  brain: string | null;
  note?: string | undefined;
}

export class AIRouter {
  private providers: Map<ProviderId, AIProvider>;

  constructor(
    private settings: Settings,
    hooks: ProviderHooks = {},
  ) {
    this.providers = new Map<ProviderId, AIProvider>([
      ["phone_local", new PhoneLocalProvider(settings.ai.phoneLocal, hooks)],
      ["ollama", new OllamaProvider(settings.ai.ollama, hooks)],
      ["cloud", new OnlineApiProvider(settings.ai.cloud, hooks)],
    ]);
  }

  states(): ProviderState[] {
    return PROVIDER_IDS.map((id) => this.providers.get(id)!.getState());
  }

  state(id: ProviderId): ProviderState {
    return this.providers.get(id)!.getState();
  }

  provider(id: ProviderId): AIProvider | null {
    return this.providers.get(id) ?? null;
  }

  /** Ordered fallback chain for a job; empty means "deterministic only". */
  chainFor(job: AiJob): ProviderId[] {
    const ai = this.settings.ai;
    const jobMode = ai.advancedRouting ? ai.jobBrains[job] : "auto";
    const mode: AiMode = jobMode === "auto" ? ai.mode : jobMode;
    if (mode === "off") return [];
    if (mode !== "auto") return [mode];
    const chain: ProviderId[] = ["phone_local", "ollama"];
    if (ai.cloudFallback !== false && ai.cloud.enabled) chain.push("cloud");
    return chain;
  }

  /** The brain that would actually answer right now, or null for deterministic. */
  activeBrain(job: AiJob = "chat"): ProviderState | null {
    for (const id of this.chainFor(job)) {
      const state = this.providers.get(id)?.getState();
      if (state?.status === "connected") return state;
    }
    return null;
  }

  activeBrainLabel(job: AiJob = "chat"): string {
    const brain = this.activeBrain(job);
    if (brain) return `${brain.model ?? brain.label} — ${brain.label} — Connected`;
    return `${DETERMINISTIC_LABEL} — no AI connected`;
  }

  anyConnected(): boolean {
    return this.states().some((s) => s.status === "connected");
  }

  /**
   * Runs `operation` down the chain and falls back to the deterministic engine
   * if no provider answers usefully. Errors never bubble into the game loop.
   */
  async run<T>(
    job: AiJob,
    operation: (provider: AIProvider) => Promise<T>,
    fallback: () => T,
  ): Promise<AiOutcome<T>> {
    let note: string | undefined;
    for (const id of this.chainFor(job)) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      if (provider.getState().status !== "connected") continue;
      try {
        return { value: await operation(provider), source: "ai", brain: this.brainLabel(provider) };
      } catch (error) {
        note =
          error instanceof MalformedAiResponseError
            ? `${provider.label} returned an unusable response.`
            : error instanceof Error
              ? error.message
              : `${provider.label} failed.`;
      }
    }
    return {
      value: fallback(),
      source: "engine",
      brain: DETERMINISTIC_LABEL,
      note: note ?? (this.chainFor(job).length ? "AI unavailable — using local game intelligence." : undefined),
    };
  }

  private brainLabel(provider: AIProvider): string {
    const state = provider.getState();
    return state.model ? `${provider.label} · ${state.model}` : provider.label;
  }
}
