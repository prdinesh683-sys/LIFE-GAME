import { describe, expect, it } from "vitest";

import { createSettings } from "../../data/seed";
import type { Settings } from "../../game/types";
import { AIRouter, DETERMINISTIC_LABEL } from "../router";
import { MalformedAiResponseError } from "../schemas";
import type { AIProvider } from "../types";

function settingsWith(patch: (s: Settings) => void): Settings {
  const settings = createSettings("device-test");
  patch(settings);
  return settings;
}

describe("AI router", () => {
  it("runs deterministic-only when AI is off", async () => {
    const router = new AIRouter(settingsWith((s) => (s.ai.mode = "off")));
    expect(router.chainFor("chat")).toEqual([]);
    expect(router.activeBrain("chat")).toBeNull();
    expect(router.activeBrainLabel("chat")).toContain("no AI connected");

    const outcome = await router.run<string>("chat", async () => "ai", () => "engine");
    expect(outcome.value).toBe("engine");
    expect(outcome.source).toBe("engine");
    expect(outcome.brain).toBe(DETERMINISTIC_LABEL);
  });

  it("prefers local brains before cloud in auto mode", () => {
    const router = new AIRouter(
      settingsWith((s) => {
        s.ai.mode = "auto";
        s.ai.cloud.enabled = true;
      }),
    );
    expect(router.chainFor("chat")).toEqual(["phone_local", "ollama", "cloud"]);
  });

  it("keeps cloud out of the chain when cloud fallback is disabled", () => {
    const router = new AIRouter(
      settingsWith((s) => {
        s.ai.cloud.enabled = true;
        s.ai.cloudFallback = false;
      }),
    );
    expect(router.chainFor("chat")).not.toContain("cloud");
  });

  it("honours per-job routing only when advanced routing is on", () => {
    const off = new AIRouter(settingsWith((s) => (s.ai.jobBrains.quest = "ollama")));
    expect(off.chainFor("quest")).toEqual(["phone_local", "ollama"]);

    const on = new AIRouter(
      settingsWith((s) => {
        s.ai.advancedRouting = true;
        s.ai.jobBrains.quest = "ollama";
      }),
    );
    expect(on.chainFor("quest")).toEqual(["ollama"]);
  });

  it("reports no connected provider before any handshake", () => {
    const router = new AIRouter(createSettings("device-test"));
    expect(router.anyConnected()).toBe(false);
    expect(router.states().every((s) => s.status !== "connected")).toBe(true);
  });

  it("falls back to the engine when a connected provider fails", async () => {
    const failing = {
      id: "ollama",
      label: "Ollama",
      getState: () => ({
        id: "ollama",
        label: "Ollama",
        status: "connected",
        model: "llama3",
        models: ["llama3"],
        detail: "ok",
        testedAt: null,
      }),
    } as unknown as AIProvider;

    const router = new AIRouter(settingsWith((s) => (s.ai.mode = "ollama")));
    (router as unknown as { providers: Map<string, AIProvider> }).providers.set("ollama", failing);

    const outcome = await router.run(
      "chat",
      async () => {
        throw new MalformedAiResponseError("bad json", "unparseable");
      },
      () => "engine",
    );
    expect(outcome.value).toBe("engine");
    expect(outcome.source).toBe("engine");
    expect(outcome.note).toBeTruthy();
  });

  it("uses the AI answer when a provider succeeds", async () => {
    const fake: AIProvider = {
      id: "ollama",
      label: "Ollama",
      getState: () => ({
        id: "ollama",
        label: "Ollama",
        status: "connected",
        model: "llama3",
        models: ["llama3"],
        detail: "ok",
        testedAt: null,
      }),
      testConnection: async () => fake.getState(),
      listModels: async () => ["llama3"],
    } as unknown as AIProvider;

    const router = new AIRouter(settingsWith((s) => (s.ai.mode = "ollama")));
    (router as unknown as { providers: Map<string, AIProvider> }).providers.set("ollama", fake);

    const outcome = await router.run("chat", async () => "from-ai", () => "engine");
    expect(outcome.value).toBe("from-ai");
    expect(outcome.source).toBe("ai");
    expect(outcome.brain).toContain("Ollama");
  });
});
