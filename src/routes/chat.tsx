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
      <div className="mb-3 flex items-center justify-between gap-2">
        <BrainChip />
        <div className="flex gap-1.5">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="New conversation"
            onClick={() => void ai.newConversation()}
          >
            <MessageSquarePlus className="size-4" />
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                History
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 bg-surface">
              <SheetTitle className="font-display">Conversations</SheetTitle>
              <div className="mt-4 space-y-1">
                {ai.conversations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No conversations yet.</p>
                ) : null}
                {ai.conversations.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <button
                      className={`flex-1 truncate rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface-raised ${
                        c.id === ai.activeConversationId ? "bg-surface-raised text-foreground" : "text-muted-foreground"
                      }`}
                      onClick={() => void ai.selectConversation(c.id)}
                    >
                      {c.title}
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${c.title}`}
                      onClick={() => void ai.deleteConversation(c.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {!ai.aiConnected ? (
        <div className="mb-3 rounded-lg border border-border/60 bg-surface/60 p-3 text-xs text-muted-foreground">
          <span className="text-foreground">No AI brain connected.</span> Chat still works — your
          local game intelligence answers from your own records, and every number stays
          deterministic. Connect Ollama, a phone-local model or an online API in AI Control.
        </div>
      ) : null}

      <Panel className="flex h-[52vh] flex-col p-0">
        <Conversation className="flex-1">
          <ConversationContent className="gap-4">
            {ai.turns.length === 0 ? (
              <ConversationEmptyState
                title="Ask about your own life data"
                description="Momentum, misses, patterns, what to do next — answers are grounded in your records, never invented."
              />
            ) : null}
            {ai.turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} />
            ))}
            {ai.thinking ? <Shimmer className="text-sm">Thinking…</Shimmer> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="border-t border-border/60 p-3">
          <PromptInput onSubmit={submit}>
            <PromptInputTextarea placeholder="Ask your brain anything about your progress…" />
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
