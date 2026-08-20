import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { EmptyState, Panel, Pill, SectionTitle } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { counterMoveFor } from "@/lib/game/behavior-engine";
import { newId } from "@/lib/game/quest-engine";
import { optionToDraft } from "@/lib/game/recommendation-engine";
import type { Drain } from "@/lib/game/types";
import { useGame } from "@/lib/services/game-store";

export const Route = createFileRoute("/drains")({
  head: () => ({
    meta: [
      { title: "Drains — Life Game" },
      {
        name: "description",
        content:
          "Name the habits that pull you away, log them without shame, and swap each one for a counter-move.",
      },
      { property: "og:title", content: "Drains — Life Game" },
      {
        property: "og:description",
        content: "Log what pulls you away and swap it for a counter-move.",
      },
    ],
  }),
  component: DrainsPage,
});

function DrainsPage() {
  const { snapshot, logDrain, saveDrain, removeDrain, createQuest, startQuest } = useGame();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");

  if (!snapshot) return <AppShell title="Drains">{null}</AppShell>;

  const add = async () => {
    if (name.trim().length < 2) {
      toast.error("Give the Drain a name");
      return;
    }
    const drain: Drain = {
      id: newId("drain"),
      name: name.trim(),
      trigger: trigger.trim() || "unclear",
      frequency: "often",
      context: "",
      typicalTime: "evening",
      intensity: 3,
      consequence: "",
      replacement: "",
      counterMoveMinutes: 10,
      counterMoveAttribute: "vitality",
      createdAt: new Date().toISOString(),
    };
    await saveDrain(drain);
    setName("");
    setTrigger("");
    toast.success("Drain tracked");
  };

  return (
    <AppShell title="Drains 🕳️" subtitle="Named, not judged">
      <div className="space-y-4">
        <Panel>
          <SectionTitle>Add a Drain</SectionTitle>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Endless scrolling"
            className="bg-background/50"
            aria-label="Drain name"
          />
          <Input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="Trigger — e.g. bored after dinner"
            className="mt-2 bg-background/50"
            aria-label="Trigger"
          />
          <Button className="mt-2 w-full" onClick={() => void add()}>
            <Plus className="size-4" />
            Track it
          </Button>
        </Panel>

        {snapshot.drains.length ? (
          <div className="space-y-3">
            {snapshot.drains.map((drain) => {
              const counter = counterMoveFor(drain, snapshot.boosts);
              return (
                <Panel key={drain.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold">{drain.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Trigger: {drain.trigger} · {drain.typicalTime}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${drain.name}`}
                      className="text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => void removeDrain(drain.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Pill tone="drain">Intensity {drain.intensity}</Pill>
                    <Pill>{drain.frequency}</Pill>
                  </div>
                  <p className="mt-3 rounded-md border border-border/60 bg-background/40 p-3 text-sm">
                    <span className="text-muted-foreground">Counter-move: </span>
                    {counter.title} · {counter.minutes}m
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        const quest = await createQuest(
                          optionToDraft({
                            id: `counter_${drain.id}`,
                            category: "recovery",
                            title: counter.title,
                            durationMinutes: counter.minutes,
                            reason: `Counter-move for ${drain.name}`,
                            sparks: 0,
                            attribute: counter.attribute,
                            destinationId: null,
                            destinationTitle: null,
                            difficulty: "easy",
                            boostId: counter.boostId,
                            isRecovery: true,
                            rush: false,
                            source: "engine",
                          }),
                        );
                        await startQuest(quest.id);
                        toast.success("Counter-move started");
                        await navigate({ to: "/" });
                      }}
                    >
                      Swap it now
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await logDrain(drain.id);
                        toast("Logged. No penalty — just data.");
                      }}
                    >
                      It happened
                    </Button>
                  </div>
                </Panel>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No Drains tracked"
            body="Naming a Drain is how the system learns what to offer instead."
          />
        )}
      </div>
    </AppShell>
  );
}