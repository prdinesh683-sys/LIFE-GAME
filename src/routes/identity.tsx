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
        <Panel glow className="border-primary/40 bg-gradient-to-br from-surface-raised/90 via-surface to-background p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
                {profile.chapter}
              </p>
              <h2 className="font-display text-3xl font-black text-foreground">{profile.displayName}</h2>
            </div>
            <Pill tone="primary">Rank {profile.rank}</Pill>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill tone="spark">{profile.lifetimeSparks} lifetime Sparks ✨</Pill>
            <Pill tone="accent">{momentum.label}</Pill>
          </div>
          <div className="mt-4">
            <ProgressRail
              ratio={rank.ratio}
              label={`${rank.intoRank}/${rank.needed} Sparks to next Rank`}
              tone="momentum"
            />
          </div>
        </Panel>

        <div className="grid grid-cols-3 gap-2.5">
          <StatTile label="Current Run" value={`${profile.currentRun}d`} tone="run" />
          <StatTile label="Personal Best" value={`${profile.bestRun}d`} />
          <StatTile label="Combo Multiplier" value={`x${profile.combo || 1}`} tone="spark" />
        </div>

        <div>
          <SectionTitle>Core Attributes & Energy Pillars</SectionTitle>
          <Panel className="space-y-3.5 border-border/80 bg-surface/80 p-5">
            {ATTRIBUTE_KEYS.map((key) => {
              const points = attributeLabelPoints(snapshot, key);
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-foreground">{ATTRIBUTE_LABELS[key]}</span>
                    <span className="numeric font-bold text-accent">{points} pts</span>
                  </div>
                  <ProgressRail ratio={points / maxPoints} tone="momentum" />
                </div>
              );
            })}
          </Panel>
        </div>

        <div>
          <SectionTitle>Trophies & Milestones 🏆</SectionTitle>
          {trophies.length ? (
            <div className="grid grid-cols-2 gap-2.5">
              {trophies.map((trophy) => (
                <Panel key={trophy.id} className="border-border/70 bg-surface/80 p-4 transition-colors hover:border-primary/40">
                  <p className="text-2xl">{trophy.icon}</p>
                  <p className="mt-2 font-display text-sm font-bold text-foreground">{trophy.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{trophy.description}</p>
                </Panel>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No trophies unlocked yet"
              body="Trophies unlock from real actions—first quest completion, maintaining your Run streak, and ranking up."
            />
          )}
        </div>

        {blueprint ? (
          <div>
            <SectionTitle>Active Campaign Blueprint</SectionTitle>
            <Panel className="space-y-3.5 border-border/80 bg-surface/80 p-5">
              <p className="font-display text-base font-bold leading-snug text-foreground">{blueprint.direction}</p>
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