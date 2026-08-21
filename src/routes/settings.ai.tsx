import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, Plug, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { ProposalCard } from "@/components/app/proposal-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MEMORY_KIND_LABELS } from "@/lib/ai/records";
import { AI_JOB_LABELS, AI_MODE_LABELS } from "@/lib/ai/router";
import type { ProviderId } from "@/lib/ai/types";
import type { AiJob, AiMode, AiProviderSettings } from "@/lib/game/types";
import { useAi } from "@/lib/services/ai-store";
import { useGame } from "@/lib/services/game-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/ai")({
  head: () => ({
    meta: [
      { title: "AI Control Center — Life Game" },
      {
        name: "description",
        content:
          "Connect Ollama, a phone-local model or an online API, choose which brain handles which job, and keep the game fully playable with no AI at all.",
      },
      { property: "og:title", content: "AI Control Center — Life Game" },
      {
        property: "og:description",
        content: "Swap AI brains per job, test real connections, or run the game with no AI at all.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AiSettingsPage,
});

const MODES = Object.keys(AI_MODE_LABELS) as AiMode[];

const PROVIDER_COPY: Record<ProviderId, { title: string; blurb: string; endpointHint: string }> = {
  phone_local: {
    title: "Phone Local Model",
    blurb:
      "An on-device or LAN model exposing an OpenAI-compatible /chat/completions endpoint. Nothing leaves your device.",
    endpointHint: "http://127.0.0.1:8080/v1",
  },
  ollama: {
    title: "Ollama",
    blurb: "Your own Ollama install. Called directly from this device — no server in between.",
    endpointHint: "http://localhost:11434",
  },
  cloud: {
    title: "Online API",
    blurb:
      "Any OpenAI-compatible API. Only the minimum context layer is sent, and a daily request cap is enforced before anything leaves.",
    endpointHint: "https://api.openai.com/v1",
  },
};

function AiSettingsPage() {
  const { snapshot, router, updateSettings } = useGame();
  const ai = useAi();
  if (!snapshot) return <AppShell title="AI Control Center">{null}</AppShell>;

  const settings = snapshot.settings.ai;

  const patch = (key: "phoneLocal" | "ollama" | "cloud", value: Partial<AiProviderSettings>) =>
    void updateSettings({ ai: { ...settings, [key]: { ...settings[key], ...value } } });

  const keyFor = (id: ProviderId) =>
    id === "phone_local" ? ("phoneLocal" as const) : id === "ollama" ? ("ollama" as const) : ("cloud" as const);

  return (
    <AppShell title="AI Control Center 🧠" subtitle={router?.activeBrainLabel("chat") ?? ""}>
      <div className="space-y-4">
        <Panel glow>
          <SectionTitle>Active brain</SectionTitle>
          <p className="font-display text-base">
            {router?.activeBrainLabel("chat") ?? "Local game intelligence"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            No brain is required. Quests, rewards, ranks and recovery are always computed by the
            deterministic engine. AI only ever proposes — you approve.
          </p>
        </Panel>

        <Panel className="space-y-3">
          <SectionTitle>Default mode</SectionTitle>
          <Select
            value={settings.mode}
            onValueChange={(v) => void updateSettings({ ai: { ...settings, mode: v as AiMode } })}
          >
            <SelectTrigger className="bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {AI_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 p-3">
            <div>
              <p className="text-sm">Cloud fallback</p>
              <p className="text-xs text-muted-foreground">
                In Auto mode, try the online API when local brains are unavailable.
              </p>
            </div>
            <Switch
              checked={settings.cloudFallback !== false}
              onCheckedChange={(checked) =>
                void updateSettings({ ai: { ...settings, cloudFallback: checked } })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 p-3">
            <div>
              <p className="text-sm">Per-job brains</p>
              <p className="text-xs text-muted-foreground">
                Route chat, analysis, quests, events and planning to different brains.
              </p>
            </div>
            <Switch
              checked={settings.advancedRouting === true}
              onCheckedChange={(checked) =>
                void updateSettings({ ai: { ...settings, advancedRouting: checked } })
              }
            />
          </div>

          {settings.advancedRouting ? (
            <div className="space-y-2">
              {(Object.keys(AI_JOB_LABELS) as AiJob[]).map((job) => (
                <div key={job}>
                  <Label className="text-xs text-muted-foreground">{AI_JOB_LABELS[job]}</Label>
                  <Select
                    value={settings.jobBrains[job]}
                    onValueChange={(v) =>
                      void updateSettings({
                        ai: { ...settings, jobBrains: { ...settings.jobBrains, [job]: v as AiMode } },
                      })
                    }
                  >
                    <SelectTrigger className="mt-1 bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {AI_MODE_LABELS[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        {(["phone_local", "ollama", "cloud"] as ProviderId[]).map((id) => (
          <ProviderPanel
            key={id}
            id={id}
            value={settings[keyFor(id)]}
            onChange={(value) => patch(keyFor(id), value)}
          />
        ))}

        <Panel className="space-y-2">
          <SectionTitle>Memory</SectionTitle>
          {ai.memories.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing remembered yet. Approved decisions and stated preferences land here and are
              fed back into future AI context.
            </p>
          ) : (
            ai.memories.slice(0, 20).map((memory) => (
              <div
                key={memory.id}
                className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-background/40 p-3"
              >
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {MEMORY_KIND_LABELS[memory.kind]}
                  </p>
                  <p className="text-xs">{memory.text}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void ai.removeMemory(memory.id)}
                >
                  Forget
                </Button>
              </div>
            ))
          )}
        </Panel>

        {ai.pendingProposals.length ? (
          <section className="space-y-3">
            <SectionTitle>Waiting for your approval</SectionTitle>
            {ai.pendingProposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onDecide={(pid, decision) => void ai.decideProposal(pid, decision)}
              />
            ))}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function ProviderPanel({
  id,
  value,
  onChange,
}: {
  id: ProviderId;
  value: AiProviderSettings;
  onChange: (patch: Partial<AiProviderSettings>) => void;
}) {
  const ai = useAi();
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [customInput, setCustomInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);

  const copy = PROVIDER_COPY[id];
  const state = ai.providerStates.find((s) => s.id === id);
  const models = value.availableModels ?? [];

  const isFreeModel = (m: string) => m.toLowerCase().includes(":free") || m.toLowerCase().endsWith("-free");
  const freeModels = useMemo(() => models.filter(isFreeModel), [models]);
  const hasFreeModels = freeModels.length > 0;

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (onlyFree && !isFreeModel(m)) return false;
      if (searchQuery.trim() && !m.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
      return true;
    });
  }, [models, onlyFree, searchQuery]);

  const test = async () => {
    setTesting(true);
    try {
      const result = await ai.testProvider(id);
      if (result?.status === "connected") toast.success(`${copy.title} connected — ${result.detail}`);
      else toast.error(result?.detail ?? "Could not reach this provider.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed.");
    } finally {
      setTesting(false);
    }
  };

  const refreshModels = async () => {
    if (id === "cloud" && (!value.endpoint?.trim() || !value.apiKey?.trim())) {
      toast.error("Please configure the endpoint and API key first.");
      return;
    }
    if (id !== "cloud" && !value.endpoint?.trim()) {
      toast.error("Please configure the endpoint first.");
      return;
    }
    setLoadingModels(true);
    try {
      const list = await ai.loadModels(id);
      toast.success(list.length ? `${list.length} model(s) found.` : "No models reported.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not list models.");
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <Panel className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <SectionTitle>{copy.title}</SectionTitle>
          <p className="text-xs text-muted-foreground">{copy.blurb}</p>
        </div>
        <Switch checked={value.enabled} onCheckedChange={(checked) => onChange({ enabled: checked })} />
      </div>

      <div className="flex items-center gap-2">
        <Pill tone={state?.status === "connected" ? "primary" : "muted"}>
          {(state?.status ?? "not_connected").replace(/_/g, " ")}
        </Pill>
        <span className="truncate text-xs text-muted-foreground">{state?.detail}</span>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Endpoint</Label>
        <Input
          value={value.endpoint}
          placeholder={copy.endpointHint}
          className="bg-background/50"
          onChange={(e) => onChange({ endpoint: e.target.value })}
        />
        {id !== "ollama" ? (
          <>
            <Label className="text-xs text-muted-foreground">API key (stored on this device only)</Label>
            <Input
              type="password"
              value={value.apiKey}
              placeholder="sk-…"
              className="bg-background/50"
              onChange={(e) => onChange({ apiKey: e.target.value })}
            />
          </>
        ) : null}

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Model</Label>
          {models.length ? (
            <button
              type="button"
              onClick={() => setCustomInput(!customInput)}
              className="text-[11px] text-primary hover:underline cursor-pointer"
            >
              {customInput ? "Choose from loaded models" : "Type custom model name"}
            </button>
          ) : null}
        </div>

        {models.length && !customInput ? (
          <div className="space-y-1.5">
            {models.length > 6 || hasFreeModels ? (
              <div className="flex items-center gap-2">
                <Input
                  value={searchQuery}
                  placeholder="Filter models (e.g. llama, gemini, claude)..."
                  className="h-7 text-xs bg-background/50"
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {hasFreeModels ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={onlyFree ? "secondary" : "outline"}
                    className={cn("h-7 px-2 text-[11px] whitespace-nowrap", onlyFree && "border-primary/50 text-primary")}
                    onClick={() => setOnlyFree(!onlyFree)}
                  >
                    ✨ Free only ({freeModels.length})
                  </Button>
                ) : null}
              </div>
            ) : null}
            <Select value={value.model} onValueChange={(v) => onChange({ model: v })}>
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Pick a model" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {filteredModels.length ? (
                  filteredModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      <span className="flex items-center justify-between gap-2 w-full">
                        <span className="truncate">{model}</span>
                        {isFreeModel(model) ? (
                          <span className="text-[10px] uppercase font-bold text-primary px-1 py-0.5 rounded bg-primary/10">
                            Free
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))
                ) : (
                  <div className="p-2 text-center text-xs text-muted-foreground">
                    No models match your filter
                  </div>
                )}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="truncate">Selected: {value.model || "None"}</span>
              <span className="shrink-0">{filteredModels.length} of {models.length} model(s)</span>
            </div>
          </div>
        ) : (
          <Input
            value={value.model}
            placeholder="e.g. openai/gpt-4o-mini, anthropic/claude-3.5-sonnet, or meta-llama/llama-3.3-70b-instruct:free"
            className="bg-background/50"
            onChange={(e) => onChange({ model: e.target.value })}
          />
        )}

        {id === "cloud" ? (
          <>
            <Label className="text-xs text-muted-foreground">Daily request cap (0 = unlimited)</Label>
            <Input
              type="number"
              min={0}
              value={value.dailyLimit ?? 0}
              className="bg-background/50"
              onChange={(e) => onChange({ dailyLimit: Number(e.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">
              Used today: {value.requestsToday ?? 0}
            </p>
          </>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={testing} onClick={() => void test()}>
          {testing ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Plug className="mr-1 size-4" />}
          Test connection
        </Button>
        <Button size="sm" variant="ghost" disabled={loadingModels} onClick={() => void refreshModels()}>
          {loadingModels ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 size-4" />
          )}
          Models
        </Button>
      </div>
      {value.lastTestedAt ? (
        <p className="text-[11px] text-muted-foreground">
          Last tested {new Date(value.lastTestedAt).toLocaleString()}
        </p>
      ) : null}
    </Panel>
  );
}
