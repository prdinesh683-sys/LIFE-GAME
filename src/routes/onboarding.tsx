import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { proposeBlueprint, type BlueprintProposal } from "@/lib/game/blueprint-parser";
import { useGame } from "@/lib/services/game-store";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Build your Life Game — Your game setup" },
      {
        name: "description",
        content:
          "Describe the life you want in your own words and approve the game setup that drives your quests.",
      },
      { property: "og:title", content: "Build your Life Game — Your game setup" },
      {
        property: "og:description",
        content: "Describe your direction, approve your game setup, start your first Quest.",
      },
    ],
  }),
  component: OnboardingPage,
});

const EXAMPLE =
  "I want to become more active, productive and energetic, reduce passive gaming and scrolling, study consistently, work on projects, have interesting things to do, and still keep entertainment.";

type Stage = "welcome" | "describe" | "review";

function OnboardingPage() {
  const { ready, snapshot, approveBlueprint } = useGame();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("welcome");
  const [raw, setRaw] = useState("");
  const [variant, setVariant] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BlueprintProposal | null>(null);
  const [saving, setSaving] = useState(false);

  const proposal = useMemo(() => draft ?? proposeBlueprint(raw, variant), [draft, raw, variant]);

  if (ready && snapshot?.settings.onboardingComplete) {
    return (
      <AppShell title="Game setup" subtitle="Already approved">
        <Panel>
          <p className="text-sm text-muted-foreground">
            Your game setup is approved. You can change it later in Settings.
          </p>
          <Button className="mt-4 w-full" onClick={() => void navigate({ to: "/" })}>
            Go to Home
          </Button>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell title="Welcome" subtitle="Build your Life Game" hideNav>
      {stage === "welcome" ? (
        <div className="space-y-4">
          <Panel glow className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              Personal Life RPG
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold leading-tight">
              Build your Life Game.
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
              Real actions earn Sparks. Sparks raise your Rank. Nothing in here counts unless it
              happened in the real world.
            </p>
            <Button size="lg" className="mt-6 w-full" onClick={() => setStage("describe")}>
              Start
            </Button>
          </Panel>
          <Panel>
            <SectionTitle>What happens next</SectionTitle>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li>1. Describe the life you want, in your own words.</li>
              <li>2. Approve the game setup that gets generated from it.</li>
              <li>3. Get your first Quest and go do it.</li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              Everything stays on this device. No account, no cloud database.
            </p>
          </Panel>
        </div>
      ) : null}

      {stage === "describe" ? (
        <div className="space-y-4">
          <Panel>
            <SectionTitle>Describe yourself</SectionTitle>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={8}
              placeholder={EXAMPLE}
              className="bg-background/50"
            />
            <button
              type="button"
              className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => setRaw(EXAMPLE)}
            >
              Use the example
            </button>
          </Panel>
          <Button
            size="lg"
            className="w-full"
            disabled={raw.trim().length < 12}
            onClick={() => {
              setDraft(null);
              setStage("review");
            }}
          >
            Build my game setup
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            No AI brain is connected yet, so the deterministic interpreter builds this. You approve
            everything either way.
          </p>
        </div>
      ) : null}

      {stage === "review" ? (
        <div className="space-y-4">
          <Panel glow>
            <Pill tone="primary">This is what I understood</Pill>
            <h2 className="mt-3 font-display text-xl font-semibold leading-snug">
              {proposal.direction}
            </h2>
          </Panel>

          {editing ? (
            <Panel className="space-y-3">
              <SectionTitle>Edit</SectionTitle>
              <EditList
                label="Goals"
                values={proposal.goals}
                onChange={(goals) => setDraft({ ...proposal, goals })}
              />
              <EditList
                label="Anti-goals"
                values={proposal.antiGoals}
                onChange={(antiGoals) => setDraft({ ...proposal, antiGoals })}
              />
              <EditList
                label="Constraints"
                values={proposal.constraints}
                onChange={(constraints) => setDraft({ ...proposal, constraints })}
              />
              <Button variant="secondary" className="w-full" onClick={() => setEditing(false)}>
                Done editing
              </Button>
            </Panel>
          ) : (
            <div className="space-y-3">
              <ListPanel title="Goals 🗺️" items={proposal.goals} />
              <ListPanel title="Priorities" items={proposal.priorities} />
              <ListPanel title="Motivators" items={proposal.motivators} />
              <ListPanel title="Anti-goals 🕳️" items={proposal.antiGoals} tone="drain" />
              <ListPanel title="Constraints" items={proposal.constraints} />
              <Panel>
                <SectionTitle>Style</SectionTitle>
                <p className="text-sm">{proposal.preferredQuestStyle}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill tone="accent">Difficulty: {proposal.preferredDifficulty}</Pill>
                  <Pill>{proposal.boostCategories.length} starter Boosts</Pill>
                  <Pill tone="drain">{proposal.drainNames.length} Drains tracked</Pill>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{proposal.behaviorStrategy}</p>
              </Panel>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Button
              size="lg"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await approveBlueprint(raw, proposal);
                  toast.success("Game setup approved. Your first Quest is ready.");
                  await navigate({ to: "/" });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not save your game setup");
                } finally {
                  setSaving(false);
                }
              }}
            >
              ✅ Approve
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setEditing((v) => !v)}>
              ✏️ Edit
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setDraft(null);
                setVariant((v) => v + 1);
              }}
            >
              🔄 Regenerate
            </Button>
          </div>
          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setStage("describe")}
          >
            Back to my description
          </button>
        </div>
      ) : null}
    </AppShell>
  );
}

function ListPanel({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "drain";
}) {
  if (!items.length) return null;
  return (
    <Panel>
      <SectionTitle>{title}</SectionTitle>
      <ul className="space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className={tone === "drain" ? "text-drain" : "text-primary"}>▸</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EditList({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="space-y-1.5">
        {values.map((value, index) => (
          <Input
            key={`${label}-${index}`}
            value={value}
            className="bg-background/50"
            onChange={(e) => {
              const next = [...values];
              next[index] = e.target.value;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}