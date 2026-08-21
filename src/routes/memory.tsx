import { createFileRoute } from "@tanstack/react-router";
import { Archive, CloudUpload, Layers, Pin, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app/app-shell";
import { EmptyState, Panel, Pill, SectionTitle, StatTile } from "@/components/app/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { normalizeMemory, type MemoryRecord } from "@/lib/ai/records";
import { explainProvenance, provenanceOf } from "@/lib/memory/memory-provenance";
import { explainScore, scoreMemory } from "@/lib/memory/memory-scoring";
import { preferenceTimeline } from "@/lib/memory/memory-versioning";
import { followThroughByWindow } from "@/lib/memory/follow-through";
import { detectPatternCandidates } from "@/lib/memory/pattern-engine";
import { useAi } from "@/lib/services/ai-store";
import { useGame } from "@/lib/services/game-store";
import { useSync } from "@/lib/services/sync-store";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "Memory — Life Game" },
      {
        name: "description",
        content:
          "Everything the game remembers about you, why it remembers it, how confident it is, and what it learned from your decisions. You can edit, archive or delete any of it.",
      },
      { property: "og:title", content: "Memory — Life Game" },
      {
        property: "og:description",
        content: "Inspect, correct and prune what the game remembers. Nothing is hidden.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MemoryPage,
});

const KIND_LABEL: Record<string, string> = {
  FACT: "Fact",
  USER_PREFERENCE: "Your preference",
  OBSERVED_PATTERN: "Observed pattern",
  APPROVED_DECISION: "Approved decision",
  AI_HYPOTHESIS: "Hypothesis",
};

type Tab = "active" | "patterns" | "timeline" | "archive";
type KindFilter = "ALL" | keyof typeof KIND_LABEL;

const KIND_FILTERS: KindFilter[] = [
  "ALL",
  "FACT",
  "USER_PREFERENCE",
  "OBSERVED_PATTERN",
  "AI_HYPOTHESIS",
  "APPROVED_DECISION",
];

function MemoryPage() {
  const ai = useAi();
  const sync = useSync();
  const { snapshot } = useGame();
  const [tab, setTab] = useState<Tab>("active");
  const [kind, setKind] = useState<KindFilter>("ALL");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MemoryRecord | null>(null);

  // Phase 6B: a projection over the existing pattern candidates — no new
  // scoring, no new store, just "when do I actually follow through?".
  const followThrough = useMemo(
    () =>
      followThroughByWindow(
        snapshot ? detectPatternCandidates(snapshot.questRuns, snapshot.events) : [],
      ),
    [snapshot],
  );

  const rows = useMemo(() => ai.memories.map(normalizeMemory), [ai.memories]);
  const active = rows.filter((m) => m.status === "active");
  const health = ai.memoryHealthReport;

  const scoped =
    tab === "archive"
      ? rows.filter((m) => m.status !== "active")
      : tab === "patterns"
        ? active.filter((m) => m.kind === "OBSERVED_PATTERN" || m.kind === "AI_HYPOTHESIS")
        : active;
  const visible = kind === "ALL" ? scoped : scoped.filter((m) => m.kind === kind);


  /**
   * Selective archive: exactly this one memory travels to your vault, and the
   * local copy is only archived once Drive confirmed the upload.
   */
  const archiveToDrive = async (memory: MemoryRecord) => {
    setBusy(true);
    try {
      const result = await sync.archiveMemories(rows, [memory.id]);
      await ai.setMemoryStatus(memory.id, "archived");
      toast.success(`Archived to Drive · ${result.name}`);
    } catch (error) {
      // Drive failing never touches local memory — the memory stays active.
      toast.error(
        error instanceof Error
          ? `Not archived: ${error.message} It is still here on this device.`
          : "Drive upload failed. The memory is still here on this device.",
      );
    } finally {
      setBusy(false);
    }
  };

  const run = async (label: string, fn: () => Promise<number | void>) => {
    setBusy(true);
    try {
      const count = await fn();
      toast.success(typeof count === "number" ? `${label}: ${count}` : label);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Memory" subtitle="What matters about your journey">
      <div className="space-y-6">
        <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-surface-raised/60 to-surface/40 p-5">
          <SectionTitle>Follow-Through Patterns</SectionTitle>
          {followThrough.hasEvidence ? (
            <ul className="mt-2 space-y-1.5 text-xs text-foreground">
              {followThrough.slots.map((slot) => (
                <li key={slot.slot} className="flex items-center gap-2">
                  <span className="text-primary">•</span>
                  <span>{slot.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{followThrough.headline}</p>
          )}
        </div>

        <div className="space-y-3">
          <SectionTitle>Memory Health</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile label="Active Memories" value={health.active} />
            <StatTile label="Patterns" value={health.patterns} />
            <StatTile label="Health Score" value={`${health.score}`} hint={health.band} tone="momentum" />
            <StatTile label="Duplicates" value={health.duplicateGroups} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              disabled={busy}
              onClick={() => void run("Patterns updated", ai.refreshPatterns)}
            >
              <Sparkles className="mr-1.5 size-3.5 text-primary" /> Review patterns
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              disabled={busy}
              onClick={() => void run("Duplicate groups merged", ai.consolidateDuplicates)}
            >
              <Layers className="mr-1.5 size-3.5 text-accent" /> Consolidate duplicates
            </Button>
          </div>
        </div>

        {ai.memoryProposals.length ? (
          <div className="space-y-3">
            <SectionTitle>Suggested by Brain — Waiting for Approval</SectionTitle>
            <div className="space-y-2.5">
              {ai.memoryProposals.map((proposal) => (
                <div key={proposal.id} className="rounded-2xl border border-primary/30 bg-surface/80 p-5 shadow-sm">
                  <p className="font-display text-sm font-semibold text-foreground">{proposal.title}</p>
                  <ul className="mt-2.5 space-y-1.5 text-xs text-muted-foreground">
                    {((proposal.payload as { drafts?: { kind: string; text: string }[] }).drafts ?? []).map(
                      (draft, index) => (
                        <li key={`${proposal.id}-${index}`} className="flex items-center gap-2">
                          <Pill tone="spark">{KIND_LABEL[draft.kind] ?? draft.kind}</Pill>
                          <span>{draft.text}</span>
                        </li>
                      ),
                    )}
                  </ul>
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      className="text-xs font-semibold"
                      disabled={busy}
                      onClick={() => void run("Remembered", () => ai.decideProposal(proposal.id, "approved"))}
                    >
                      Remember these
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      disabled={busy}
                      onClick={() => void run("Dismissed", () => ai.decideProposal(proposal.id, "rejected"))}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {(["active", "patterns", "timeline", "archive"] as Tab[]).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={tab === value ? "default" : "outline"}
              className="text-xs font-semibold"
              onClick={() => setTab(value)}
            >
              {value === "active"
                ? "All memories"
                : value === "patterns"
                  ? "Patterns"
                  : value === "timeline"
                    ? "Learning timeline"
                    : "Archive"}
            </Button>
          ))}
        </div>

        {tab === "timeline" ? null : (
          <div className="flex flex-wrap gap-2">
            {KIND_FILTERS.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={kind === value ? "secondary" : "ghost"}
                onClick={() => setKind(value)}
              >
                {value === "ALL" ? "All types" : (KIND_LABEL[value] ?? value)}
              </Button>
            ))}
          </div>
        )}



        {tab === "timeline" ? (
          <Panel>
            <SectionTitle>Event → memory → pattern → decision → outcome</SectionTitle>
            {ai.memoryTimeline.length === 0 ? (
              <EmptyState title="Nothing learned yet" body="Play a few quests and this fills in." />
            ) : (
              <ol className="space-y-2">
                {ai.memoryTimeline.map((entry) => (
                  <li key={entry.id} className="panel px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Pill>{entry.kind}</Pill>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(entry.at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{entry.title}</p>
                    <p className="text-[11px] text-muted-foreground">{entry.detail}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        ) : (
          <Panel>
            <SectionTitle>
              {tab === "archive" ? "Archived and superseded" : "Memories"}
            </SectionTitle>
            {visible.length === 0 ? (
              <EmptyState
                title="Nothing here yet"
                body="Memories appear as you play, decide and correct the game."
              />
            ) : (
              <ul className="space-y-2">
                {visible.map((memory) => (
                  <MemoryRow
                    key={memory.id}
                    memory={memory}
                    open={openId === memory.id}
                    onToggle={() => setOpenId(openId === memory.id ? null : memory.id)}
                    allMemories={rows}
                    busy={busy}
                    onPin={() => void ai.setMemoryPinned(memory.id, !memory.pinned)}
                    onArchive={() =>
                      void ai.setMemoryStatus(
                        memory.id,
                        memory.status === "archived" ? "active" : "archived",
                      )
                    }
                    onDelete={() => setPendingDelete(memory)}
                    onRevise={(text) =>
                      void ai.reviseMemoryText(memory.id, text, "You corrected this memory.")
                    }
                    onArchiveToDrive={() => void archiveToDrive(memory)}
                  />
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.text}” will be removed permanently. Your event history and quest
              records stay untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) void ai.removeMemory(target.id);
              }}
            >
              Delete memory
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>

  );
}

function MemoryRow({
  memory,
  open,
  onToggle,
  allMemories,
  busy,
  onPin,
  onArchive,
  onDelete,
  onRevise,
  onArchiveToDrive,
}: {
  memory: MemoryRecord;
  open: boolean;
  onToggle: () => void;
  allMemories: MemoryRecord[];
  busy: boolean;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRevise: (text: string) => void;
  onArchiveToDrive: () => void;
}) {
  const [draft, setDraft] = useState(memory.text);
  const provenance = provenanceOf(memory);
  const evidence = memory.supportingEvidenceIds ?? [];
  const contradictions = memory.contradictions ?? [];
  const score = scoreMemory({ memory });
  const versions = preferenceTimeline(allMemories, memory.id);

  return (
    <li className="panel px-3 py-2">
      <button type="button" className="w-full text-left" onClick={onToggle}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill>{KIND_LABEL[memory.kind] ?? memory.kind}</Pill>
          {memory.pinned ? <Pill>Pinned</Pill> : null}
          {provenance.trusted ? null : <Pill>Unverified</Pill>}
          {memory.status !== "active" ? <Pill>{memory.status}</Pill> : null}
          <span className="ml-auto text-[11px] text-muted-foreground">
            importance {memory.importanceScore ?? score.total}
          </span>
        </div>
        <p className="mt-1 text-sm">{memory.text}</p>
      </button>

      {open ? (
        <div className="mt-2 space-y-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          <p>{explainProvenance(memory)}</p>
          <p>{explainScore(score)}</p>
          {evidence.length ? <p>Backed by {evidence.length} of your own records.</p> : null}
          {contradictions.length ? (
            <p>Contradicting evidence kept: {contradictions.length}.</p>
          ) : null}
          {versions.length > 1 ? (
            <div>
              <p className="font-medium text-foreground">How this changed</p>
              <ol className="mt-1 space-y-1">
                {versions.map((version) => (
                  <li key={version.id}>
                    v{version.version} — {version.text}
                    {version.current ? " (current)" : " (replaced)"}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <textarea
            className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground"
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRevise(draft)}>
              Save correction
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onPin}>
              <Pin className="mr-1 size-4" /> {memory.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onArchive}>
              <Archive className="mr-1 size-4" />
              {memory.status === "archived" ? "Restore" : "Archive"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onArchiveToDrive}>
              <CloudUpload className="mr-1 size-4" /> Archive to Drive
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
              <Trash2 className="mr-1 size-4" /> Delete
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
