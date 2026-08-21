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
    <AppShell title="Identity" subtitle="Who am I becoming?">
      <div className="space-y-6">
        <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-surface-raised/60 to-surface/40 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {profile.chapter}
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-foreground">{profile.displayName}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Rank {profile.rank} · {profile.title}</p>
            </div>
            <div className="text-right">
              <span className="numeric text-lg font-bold text-spark">{profile.lifetimeSparks}</span>
              <p className="text-[11px] text-muted-foreground">lifetime Sparks</p>
            </div>
          </div>
          <div className="mt-5">
            <ProgressRail
              ratio={rank.ratio}
              label={`${rank.intoRank}/${rank.needed} Sparks to next rank`}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <StatTile label="Current Run" value={`${profile.currentRun}d`} tone="run" />
          <StatTile label="Personal Best" value={`${profile.bestRun}d`} />
          <StatTile label="Multiplier" value={`x${profile.combo || 1}`} tone="spark" />
        </div>

        <div className="space-y-3">
          <SectionTitle>Core Attributes</SectionTitle>
          <div className="rounded-2xl border border-border/50 bg-surface/50 p-5 space-y-3.5">
            {ATTRIBUTE_KEYS.map((key) => {
              const points = attributeLabelPoints(snapshot, key);
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{ATTRIBUTE_LABELS[key]}</span>
                    <span className="numeric text-muted-foreground">{points} pts</span>
                  </div>
                  <ProgressRail ratio={points / maxPoints} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <SectionTitle>Milestones & Trophies</SectionTitle>
          {trophies.length ? (
            <div className="grid grid-cols-2 gap-2.5">
              {trophies.map((trophy) => (
                <div key={trophy.id} className="rounded-xl border border-border/40 bg-surface/40 p-4 transition-colors">
                  <p className="text-xl">{trophy.icon}</p>
                  <p className="mt-1.5 font-display text-sm font-semibold text-foreground">{trophy.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{trophy.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No milestones unlocked yet"
              body="Milestones unlock naturally as you complete real quests and maintain your momentum."
            />
          )}
        </div>

        {blueprint ? (
          <div className="space-y-3">
            <SectionTitle>Life Blueprint</SectionTitle>
            <div className="rounded-2xl border border-border/50 bg-surface/50 p-5 space-y-3.5">
              <p className="font-display text-sm font-semibold text-foreground leading-relaxed">{blueprint.direction}</p>
              <BlueprintList label="Goals" items={blueprint.goals} />
              <BlueprintList label="Priorities" items={blueprint.priorities} />
              <BlueprintList label="Anti-goals" items={blueprint.antiGoals} />
              <BlueprintList label="Constraints" items={blueprint.constraints} />
            </div>
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