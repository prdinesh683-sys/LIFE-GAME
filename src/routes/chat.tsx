import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquarePlus, Sparkle, Target, Trash2 } from "lucide-react";

import { AppShell } from "../components/app/app-shell";
import { BrainChip } from "../components/app/brain-chip";
import { Panel, Pill } from "../components/app/primitives";
import { ProposalCard } from "../components/app/proposal-card";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "../components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "../components/ai-elements/prompt-input";
import { Shimmer } from "../components/ai-elements/shimmer";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "../components/ui/sheet";
import type { ChatTurn } from "../lib/ai/records";
import { useAi } from "../lib/services/ai-store";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat — your adaptive life brain" },
      {
        name: "description",
        content:
          "Talk to your Life RPG brain about momentum, misses and next moves. It answers from your own local data and proposes plans you approve.",
      },
      { property: "og:title", content: "Chat — your adaptive life brain" },
      {
        property: "og:description",
        content:
          "Conversation grounded in your real quest history. AI proposes, the deterministic engine decides.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatScreen,
});

function ChatScreen() {
  const ai = useAi();
  const [goal, setGoal] = useState("");
  const [questIntent, setQuestIntent] = useState("");
  const [busy, setBusy] = useState(false);

  const conversationProposals = ai.proposals.filter(
    (p) => p.conversationId === ai.activeConversationId || p.conversationId === null,
  );

  const submit = async (message: PromptInputMessage) => {
    const text = message.text?.trim();
    if (!text) return;
    await ai.send(text);
  };

  const runBusy = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Chat" subtitle="Grounded in your own data">
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <BrainChip />
        <div className="flex gap-2">
          <Button
            size="icon-sm"
            variant="outline"
            className="rounded-lg border-border/80 bg-surface-raised/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            aria-label="New conversation"
            onClick={() => void ai.newConversation()}
          >
            <MessageSquarePlus className="size-4" />
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="rounded-lg border-border/80 bg-surface-raised/70 text-xs font-semibold text-muted-foreground hover:text-foreground">
                History
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 border-border/80 bg-surface">
              <SheetTitle className="font-display text-base font-bold text-foreground">Conversation Log</SheetTitle>
              <div className="mt-4 space-y-1.5">
                {ai.conversations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No recorded sessions yet.</p>
                ) : null}
                {ai.conversations.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <button
                      className={`flex-1 truncate rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-surface-raised ${
                        c.id === ai.activeConversationId ? "bg-surface-raised font-bold text-primary" : "text-muted-foreground"
                      }`}
                      onClick={() => void ai.selectConversation(c.id)}
                    >
                      {c.title}
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${c.title}`}
                      onClick={() => void ai.deleteConversation(c.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {!ai.aiConnected ? (
        <div className="mb-3.5 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-bold text-primary">Local Intelligence Active.</span> Chat operates deterministically from your own IndexedDB records. Connect Ollama or Cloud in AI Control for enhanced reasoning.
        </div>
      ) : null}

      <Panel className="flex h-[54vh] flex-col overflow-hidden border-border/80 bg-surface/90 p-0 shadow-lg">
        <Conversation className="flex-1">
          <ConversationContent className="gap-4 p-4">
            {ai.turns.length === 0 ? (
              <ConversationEmptyState
                title="Grounded Intelligence Terminal"
                description="Inquire about momentum, behavioral patterns, chapter bottlenecks, or ask for a fresh quest draft. Responses are grounded in your real life records."
              />
            ) : null}
            {ai.turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} />
            ))}
            {ai.thinking ? <Shimmer className="text-xs font-semibold text-accent">Reasoning across 6 context layers…</Shimmer> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="border-t border-border/80 bg-background/50 p-3">
          <PromptInput onSubmit={submit}>
            <PromptInputTextarea placeholder="Ask your life brain anything about your goals or daily rhythm…" />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={ai.thinking ? "submitted" : "ready"} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </Panel>

      <section className="mt-4 space-y-3">
        <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground">
          Ask for a plan
        </h2>
        <Panel className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="A goal in your own words…"
            />
            <Button
              size="sm"
              disabled={busy || !goal.trim()}
              onClick={() =>
                void runBusy(async () => {
                  await ai.planGoal(goal.trim());
                  setGoal("");
                })
              }
            >
              <Target className="mr-1 size-4" /> Plan
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={questIntent}
              onChange={(e) => setQuestIntent(e.target.value)}
              placeholder="Something you want to turn into a quest…"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !questIntent.trim()}
              onClick={() =>
                void runBusy(async () => {
                  await ai.draftQuest(questIntent.trim(), 20);
                  setQuestIntent("");
                })
              }
            >
              <Sparkle className="mr-1 size-4" /> Draft
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Plans and quests arrive as proposals. Nothing changes in your game until you approve it.
          </p>
        </Panel>
      </section>

      {conversationProposals.length ? (
        <section className="mt-4 space-y-3">
          <h2 className="font-display text-sm uppercase tracking-[0.18em] text-muted-foreground">
            Proposals
          </h2>
          {conversationProposals.slice(0, 8).map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              busy={busy}
              onDecide={(id, decision) => void runBusy(() => ai.decideProposal(id, decision))}
            />
          ))}
        </section>
      ) : null}
    </AppShell>
  );
}

function TurnView({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <Message from="user">
        <MessageContent>{turn.text}</MessageContent>
      </Message>
    );
  }
  return (
    <Message from="assistant">
      <MessageContent className="space-y-3">
        <MessageResponse>{turn.text}</MessageResponse>
        {turn.known.length ? <Block title="Known data" items={turn.known} /> : null}
        {turn.patterns.length ? <Block title="Observed patterns" items={turn.patterns} /> : null}
        {turn.hypotheses.length ? (
          <Block title="Guesses (not facts)" items={turn.hypotheses} muted />
        ) : null}
        {turn.recommendation ? (
          <p className="text-xs">
            <span className="text-muted-foreground">Recommendation: </span>
            {turn.recommendation}
          </p>
        ) : null}
        <div className="flex items-center gap-2 pt-1">
          <Pill tone={turn.source === "ai" ? "primary" : "muted"}>
            {turn.source === "ai" ? (turn.brain ?? "AI") : "Local game intelligence"}
          </Pill>
          {turn.confidence != null ? (
            <span className="text-[10px] text-muted-foreground">
              confidence {Math.round(turn.confidence * 100)}%
            </span>
          ) : null}
        </div>
      </MessageContent>
    </Message>
  );
}

function Block({ title, items, muted }: { title: string; items: string[]; muted?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <ul className={`mt-1 space-y-0.5 text-xs ${muted ? "text-muted-foreground" : ""}`}>
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
