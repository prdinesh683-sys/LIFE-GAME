import { createFileRoute } from "@tanstack/react-router";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { EmptyState, Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newId } from "@/lib/game/quest-engine";
import { ATTRIBUTE_LABELS, type Boost } from "@/lib/game/types";
import { useGame } from "@/lib/services/game-store";

export const Route = createFileRoute("/boosts")({
  head: () => ({
    meta: [
      { title: "Boosts — Life Game" },
      {
        name: "description",
        content:
          "The real-world actions that push your life forward, and the one-tap log that turns them into Sparks.",
      },
      { property: "og:title", content: "Boosts — Life Game" },
      {
        property: "og:description",
        content: "Track the actions that push your life forward and log them in one tap.",
      },
    ],
  }),
  component: BoostsPage,
});

function BoostsPage() {
  const { snapshot, logBoost, saveBoost, removeBoost } = useGame();
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState(20);

  if (!snapshot) return <AppShell title="Boosts">{null}</AppShell>;

  const add = async () => {
    if (name.trim().length < 2) {
      toast.error("Give the Boost a name");
      return;
    }
    const boost: Boost = {
      id: newId("boost"),
      name: name.trim(),
      icon: "⚡",
      category: "custom",
      difficulty: "normal",
      durationMinutes: minutes,
      frequency: "flexible",
      sparkReward: 0,
      attribute: "focus",
      preferredTime: "any",
      minimumVersion: `${Math.max(5, Math.round(minutes / 4))} minutes counts`,
      replacesDrainId: null,
      destinationId: null,
      createdAt: new Date().toISOString(),
    };
    await saveBoost(boost);
    setName("");
    toast.success("Boost added");
  };

  return (
    <AppShell title="Boosts ⚡" subtitle={`${snapshot.boosts.length} tracked`}>
      <div className="space-y-4">
        <Panel>
          <SectionTitle>Add a Boost</SectionTitle>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <div>
              <Label htmlFor="boost-name" className="sr-only">
                Name
              </Label>
              <Input
                id="boost-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Evening walk"
                className="bg-background/50"
              />
            </div>
            <Input
              type="number"
              min={5}
              max={240}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="bg-background/50"
              aria-label="Minutes"
            />
          </div>
          <Button className="mt-2 w-full" onClick={() => void add()}>
            <Plus className="size-4" />
            Add Boost
          </Button>
        </Panel>

        {snapshot.boosts.length ? (
          <div className="space-y-3">
            {snapshot.boosts.map((boost) => (
              <Panel key={boost.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold">
                      {boost.icon} {boost.name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Minimum version: {boost.minimumVersion}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${boost.name}`}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                    onClick={() => void removeBoost(boost.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill>{boost.durationMinutes}m</Pill>
                  <Pill>{boost.frequency}</Pill>
                  <Pill tone="primary">{ATTRIBUTE_LABELS[boost.attribute]}</Pill>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={async () => {
                    await logBoost(boost.id);
                    toast.success(`${boost.name} logged`);
                  }}
                >
                  <Check className="size-4" />
                  I did this
                </Button>
              </Panel>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No Boosts yet"
            body="Boosts are the actions you want more of. Add one above."
          />
        )}
      </div>
    </AppShell>
  );
}