import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { EmptyState, Panel, SectionTitle } from "@/components/app/primitives";
import { QuestCard } from "@/components/app/quest-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { validateDraft } from "@/lib/game/quest-engine";
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  DIFFICULTIES,
  type AttributeKey,
  type Difficulty,
} from "@/lib/game/types";
import { useGame } from "@/lib/services/game-store";

export const Route = createFileRoute("/quests/")({
  head: () => ({
    meta: [
      { title: "Quests — Life Game" },
      {
        name: "description",
        content:
          "Every quest you can run, the ones you finished, and the ones you missed — plus a builder for your own.",
      },
      { property: "og:title", content: "Quests — Life Game" },
      {
        property: "og:description",
        content: "Available, completed and missed quests, plus your own quest builder.",
      },
    ],
  }),
  component: QuestsPage,
});

function QuestsPage() {
  const { snapshot, createQuest } = useGame();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState(20);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [attribute, setAttribute] = useState<AttributeKey>("focus");
  const [rush, setRush] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!snapshot) return <AppShell title="Quests">{null}</AppShell>;

  const available = snapshot.quests.filter((q) => q.status === "available");
  const completed = snapshot.quests.filter((q) => q.status === "completed");
  const missed = snapshot.quests.filter((q) => q.status === "missed");

  const submit = async () => {
    const draft = {
      name: name.trim(),
      description: description.trim(),
      durationMinutes: minutes,
      difficulty,
      attribute,
      rushWindowSeconds: rush ? minutes * 60 : null,
      createdBy: "user" as const,
    };
    const result = validateDraft(draft);
    if (!result.ok) {
      toast.error(result.errors[0] ?? "That quest isn't valid yet");
      return;
    }
    setBusy(true);
    try {
      await createQuest(draft);
      toast.success("Quest added");
      setName("");
      setDescription("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the quest");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Quests ⚔️" subtitle={`${available.length} ready to run`}>
      <Tabs defaultValue="available">
        <TabsList className="w-full">
          <TabsTrigger value="available" className="flex-1">
            Ready
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1">
            History
          </TabsTrigger>
          <TabsTrigger value="new" className="flex-1">
            <Plus className="size-4" />
            New
          </TabsTrigger>
        </TabsList>

        <TabsContent value="available" className="mt-4 space-y-3">
          {available.length ? (
            available.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                action={
                  <Button asChild variant="secondary" size="sm" className="w-full">
                    <Link to="/quests/$questId" params={{ questId: quest.id }}>
                      Open quest
                    </Link>
                  </Button>
                }
              />
            ))
          ) : (
            <EmptyState
              title="Nothing queued"
              body="Use Next Move for an instant suggestion, or build your own here."
            />
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          <div>
            <SectionTitle>Completed ✅</SectionTitle>
            <div className="space-y-3">
              {completed.length ? (
                completed.slice(0, 20).map((quest) => <QuestCard key={quest.id} quest={quest} />)
              ) : (
                <EmptyState title="No completions yet" body="Your first finished quest lands here." />
              )}
            </div>
          </div>
          <div>
            <SectionTitle>Missed — learning data</SectionTitle>
            <div className="space-y-3">
              {missed.length ? (
                missed.slice(0, 20).map((quest) => <QuestCard key={quest.id} quest={quest} />)
              ) : (
                <EmptyState
                  title="Nothing missed"
                  body="Misses are never punished here — they only teach the system."
                />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="new" className="mt-4">
          <Panel className="space-y-3">
            <div>
              <Label htmlFor="quest-name">Name</Label>
              <Input
                id="quest-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Walk to the park and back"
                className="mt-1 bg-background/50"
              />
            </div>
            <div>
              <Label htmlFor="quest-desc">Description</Label>
              <Textarea
                id="quest-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="mt-1 bg-background/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="quest-minutes">Minutes</Label>
                <Input
                  id="quest-minutes"
                  type="number"
                  min={5}
                  max={240}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  className="mt-1 bg-background/50"
                />
              </div>
              <div>
                <Label>Difficulty</Label>
                <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                  <SelectTrigger className="mt-1 bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Attribute</Label>
              <Select value={attribute} onValueChange={(v) => setAttribute(v as AttributeKey)}>
                <SelectTrigger className="mt-1 bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTRIBUTE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {ATTRIBUTE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={rush}
                onChange={(e) => setRush(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Rush quest — countdown starts the moment I begin
            </label>
            <Button className="w-full" disabled={busy} onClick={() => void submit()}>
              Add quest
            </Button>
          </Panel>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}