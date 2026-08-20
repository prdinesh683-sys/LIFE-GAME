import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app/app-shell";
import { EmptyState, Panel, Pill, ProgressRail, SectionTitle, StatTile } from "@/components/app/primitives";
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS } from "@/lib/game/types";
import { attributeLabelPoints, useGame } from "@/lib/services/game-store";

export const Route = createFileRoute("/identity")({
  head: () => ({
    meta: [
      { title: "Identity — Life Game" },
      {
        name: "description",
        content:
          "Your rank, chapter, attributes, trophies and the game setup that drives every quest you get.",
      },
      { property: "og:title", content: "Identity — Life Game" },
      {
        property: "og:description",
        content: "Rank, attributes, trophies and the game setup behind your quests.",
      },
    ],
  }),
  component: IdentityPage,
});

function IdentityPage() {
  const { snapshot, rank, momentum } = useGame();
  if (!snapshot) return <AppShell title="Identity">{null}</AppShell>;

  const { profile, blueprint, trophies } = snapshot;
  const maxPoints = Math.max(
    10,
    ...ATTRIBUTE_KEYS.map((key) => attributeLabelPoints(snapshot, key)),
  );

  return (
    <AppShell title="Identity 🧬" subtitle={profile.title}>
      <div className="space-y-4">
        <Panel glow>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {profile.chapter}
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{profile.displayName}</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone="primary">Rank {profile.rank}</Pill>
            <Pill tone="spark">{profile.lifetimeSparks} lifetime Sparks</Pill>
            <Pill>{momentum.label}</Pill>
          </div>
          <div className="mt-3">
            <ProgressRail
              ratio={rank.ratio}
              label={`${rank.intoRank}/${rank.needed} Sparks into Rank ${profile.rank}`}
            />
          </div>
        </Panel>

        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Run" value={`${profile.currentRun}d`} tone="run" />
          <StatTile label="Best" value={`${profile.bestRun}d`} />
          <StatTile label="Combo" value={`x${profile.combo || 1}`} tone="spark" />
        </div>

        <div>
          <SectionTitle>Attributes</SectionTitle>
          <Panel className="space-y-3">
            {ATTRIBUTE_KEYS.map((key) => {
              const points = attributeLabelPoints(snapshot, key);
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{ATTRIBUTE_LABELS[key]}</span>
                    <span className="numeric text-muted-foreground">{points}</span>
                  </div>
                  <ProgressRail ratio={points / maxPoints} tone="momentum" />
                </div>
              );
            })}
          </Panel>
        </div>

        <div>
          <SectionTitle>Trophies 🏆</SectionTitle>
          {trophies.length ? (
            <div className="grid grid-cols-2 gap-2">
              {trophies.map((trophy) => (
                <Panel key={trophy.id} className="p-3">
                  <p className="text-xl">{trophy.icon}</p>
                  <p className="mt-1 text-sm font-semibold">{trophy.name}</p>
                  <p className="text-xs text-muted-foreground">{trophy.description}</p>
                </Panel>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No trophies yet"
              body="They come from real milestones — first quest, first Run, first Rank up."
            />
          )}
        </div>

        {blueprint ? (
          <div>
            <SectionTitle>Game setup</SectionTitle>
            <Panel className="space-y-3">
              <p className="font-display text-base leading-snug">{blueprint.direction}</p>
              <BlueprintList label="Goals" items={blueprint.goals} />
              <BlueprintList label="Priorities" items={blueprint.priorities} />
              <BlueprintList label="Anti-goals" items={blueprint.antiGoals} />
              <BlueprintList label="Constraints" items={blueprint.constraints} />
            </Panel>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function BlueprintList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-primary">▸</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}