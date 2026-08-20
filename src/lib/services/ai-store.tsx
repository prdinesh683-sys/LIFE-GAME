import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { readDriveContextForAi } from "../sync/drive-context-bridge";
import { aiBehaviorAnalysis, aiGoalPlan, aiMissAnalysis, aiNextMove, aiQuest, askChat } from "../ai/ai-service";
import { normalizeMemory, type ChatTurn, type Conversation, type MemoryKind, type MemoryLinkRecord, type MemoryRecord, type ProposalRecord, type ProposalStatus } from "../ai/records";
import { buildMemory, type MemoryDraft } from "../memory/memory-provenance";
import { draftsToRecords, reviewProposals } from "../memory/memory-proposals";
import { rescoreAll } from "../memory/memory-scoring";
import { markUsed } from "../memory/memory-retrieval";
import { findDuplicates, consolidate } from "../memory/memory-dedupe";
import { isMeaningfulChange, reviseMemory } from "../memory/memory-versioning";
import { detectPatternCandidates, describePattern, validatedPatterns } from "../memory/pattern-engine";
import { buildLink } from "../memory/memory-links";
import { memoryHealth, type MemoryHealth } from "../memory/memory-health";
import { buildTimeline, type TimelineEntry } from "../memory/memory-timeline";
import { buildPersonalContext, layersForJob } from "../ai/personal-context-service";
import type { BehaviorAnalysisResponse, GoalPlanResponse, MissAnalysisResponse, NextMoveResponse, QuestResponse } from "../ai/schemas";
import type { ChatMessage, ProviderId, ProviderState } from "../ai/types";
import type { AiOutcome } from "../ai/router";
import type { MissAnalysisContext } from "../game/behavior-engine";
import { newId } from "../game/quest-engine";
import { generateNextMoves } from "../game/recommendation-engine";
import { dayKey } from "../game/run-engine";
import type { Destination } from "../game/types";
import { useGame } from "./game-store";

/**
 * AI STORE — owns conversations, memories and proposals.
 *
 * It never writes game state itself: approving a proposal calls the same
 * deterministic game-store actions the manual UI uses.
 */

interface AiStoreValue {
  ready: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  turns: ChatTurn[];
  memories: MemoryRecord[];
  memoryLinks: MemoryLinkRecord[];
  memoryHealthReport: MemoryHealth;
  memoryTimeline: TimelineEntry[];
  proposals: ProposalRecord[];
  pendingProposals: ProposalRecord[];
  /** AI-suggested memories awaiting your approval — nothing is stored until you accept. */
  memoryProposals: ProposalRecord[];
  thinking: boolean;
  brainLabel: string;
  providerStates: ProviderState[];
  aiConnected: boolean;
  newConversation: () => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  planGoal: (rawGoal: string) => Promise<void>;
  draftQuest: (intent: string, minutes: number) => Promise<void>;
  suggestNextMoves: () => Promise<AiOutcome<NextMoveResponse>>;
  analyzeMiss: (miss: MissAnalysisContext) => Promise<AiOutcome<MissAnalysisResponse>>;
  analyzeBehavior: () => Promise<AiOutcome<BehaviorAnalysisResponse>>;
  decideProposal: (id: string, decision: "approved" | "rejected") => Promise<void>;
  addMemory: (kind: MemoryKind, text: string) => Promise<void>;
  removeMemory: (id: string) => Promise<void>;
  /** Phase 4B — preference evolution: never overwrite, always version. */
  reviseMemoryText: (id: string, text: string, reason: string) => Promise<void>;
  setMemoryStatus: (id: string, status: "active" | "archived") => Promise<void>;
  setMemoryPinned: (id: string, pinned: boolean) => Promise<void>;
  consolidateDuplicates: () => Promise<number>;
  refreshPatterns: () => Promise<number>;
  testProvider: (id: ProviderId) => Promise<ProviderState | null>;
  loadModels: (id: ProviderId) => Promise<string[]>;
}

const AiStoreContext = createContext<AiStoreValue | null>(null);

export function AiStoreProvider({ children }: { children: ReactNode }) {
  const game = useGame();
  const { repository, router, snapshot, momentum, patchProvider } = game;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [memoryLinks, setMemoryLinks] = useState<MemoryLinkRecord[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [thinking, setThinking] = useState(false);
  const [ready, setReady] = useState(false);

  function sortByDate<T extends { createdAt: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    void (async () => {
      const [convs, mems, links, props] = await Promise.all([
        repository.list("conversations"),
        repository.list("memories"),
        repository.list("memoryLinks"),
        repository.list("proposals"),
      ]);
      if (cancelled) return;
      setMemoryLinks(links);
      const ordered = [...convs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      setConversations(ordered);
      // Phase 4B: pre-4B rows are backfilled and importance is recomputed on load.
      setMemories(rescoreAll(sortByDate(mems).reverse().map(normalizeMemory)));
      setProposals(sortByDate(props).reverse());
      const first = ordered[0]?.id ?? null;
      setActiveId(first);
      if (first) {
        const all = await repository.list("chatMessages");
        if (!cancelled) setTurns(sortByDate(all.filter((t) => t.conversationId === first)));
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const loadTurns = useCallback(
    async (conversationId: string) => {
      if (!repository) return;
      const all = await repository.list("chatMessages");
      setTurns(sortByDate(all.filter((t) => t.conversationId === conversationId)));
    },
    [repository],
  );

  const newConversation = useCallback(async () => {
    if (!repository) throw new Error("Local storage is not ready yet.");
    const iso = new Date().toISOString();
    const conversation: Conversation = { id: newId("cnv"), title: "New conversation", createdAt: iso, updatedAt: iso };
    await repository.put("conversations", conversation);
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    setTurns([]);
    return conversation.id;
  }, [repository]);

  const selectConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      await loadTurns(id);
    },
    [loadTurns],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!repository) return;
      const all = await repository.list("chatMessages");
      for (const turn of all.filter((t) => t.conversationId === id)) {
        await repository.remove("chatMessages", turn.id);
      }
      await repository.remove("conversations", id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveId(null);
        setTurns([]);
      }
    },
    [activeConversationId, repository],
  );

  const nextMoveOptions = useMemo(() => {
    if (!snapshot) return [];
    const today = snapshot.dailyStates.find((d) => d.id === dayKey()) ?? null;
    return generateNextMoves({
      config: snapshot.settings.economy,
      boosts: snapshot.boosts,
      destinations: snapshot.destinations,
      runs: snapshot.questRuns,
      today,
      momentum: momentum.value,
      blueprint: snapshot.blueprint,
      needsRecovery: game.needsRecovery,
      seed: Date.parse(dayKey()),
    });
  }, [snapshot, momentum.value, game.needsRecovery]);

  const buildContext = useCallback(
    (job: string, conversation: ChatTurn[], focus?: string) => {
      if (!snapshot) return null;
      const minimal = router?.activeBrain("chat")?.id === "cloud";
      return buildPersonalContext(snapshot, momentum.value, {
        layers: layersForJob(job),
        memories,
        conversation,
        minimal,
        ...(focus ? { focus } : {}),
        // Cloud brains never receive the Drive inventory.
        vault: minimal ? null : readDriveContextForAi(),
      });
    },
    [snapshot, momentum.value, memories, router],
  );

  const saveProposal = useCallback(
    async (record: ProposalRecord) => {
      if (!repository) return;
      await repository.put("proposals", record);
      setProposals((prev) => [record, ...prev]);
    },
    [repository],
  );

  const send = useCallback(
    async (text: string) => {
      if (!repository || thinking) return;
      const conversationId = activeConversationId ?? (await newConversation());
      const iso = new Date().toISOString();
      const userTurn: ChatTurn = {
        id: newId("msg"),
        conversationId,
        role: "user",
        text,
        known: [],
        patterns: [],
        hypotheses: [],
        recommendation: null,
        confidence: null,
        source: "engine",
        brain: null,
        proposalId: null,
        createdAt: iso,
      };
      await repository.put("chatMessages", userTurn);
      const history: ChatTurn[] = [...turns, userTurn];
      setTurns(history);
      setThinking(true);
      try {
        const context = buildContext("chat", turns);
        const messages: ChatMessage[] = turns
          .slice(-8)
          .map((t) => ({ role: t.role, content: t.text }));
        const outcome = await askChat(router, context, messages, text, nextMoveOptions);
        const answer = outcome.value;
        const assistantTurn: ChatTurn = {
          id: newId("msg"),
          conversationId,
          role: "assistant",
          text: answer.answer,
          known: answer.known_data,
          patterns: answer.observed_patterns,
          hypotheses: answer.hypotheses,
          recommendation: answer.recommendation,
          confidence: answer.confidence,
          source: outcome.source,
          brain: outcome.brain,
          proposalId: null,
          createdAt: new Date().toISOString(),
        };
        await repository.put("chatMessages", assistantTurn);
        setTurns([...history, assistantTurn]);

        // The brain may only *suggest* memories. Everything it returns is
        // structurally validated, enters as a hypothesis unless it carries real
        // evidence, and waits for your approval before it is ever stored.
        const review = reviewProposals(
          {
            type: "memory_proposal",
            memories: [
              ...answer.observed_patterns.map((text) => ({
                kind: "OBSERVED_PATTERN" as const,
                text,
                supporting_evidence_ids: [],
                related_entity_ids: [],
                confidence: answer.confidence ?? 0.4,
              })),
              ...answer.hypotheses.map((text) => ({
                kind: "AI_HYPOTHESIS" as const,
                text,
                supporting_evidence_ids: [],
                related_entity_ids: [],
                confidence: 0.3,
              })),
            ].slice(0, 5),
          },
          { deviceId: snapshot?.settings.deviceId ?? null },
        );
        const fresh = review.accepted.filter(
          (draft) => !memories.some((m) => m.text.trim() === draft.text.trim()),
        );
        if (fresh.length) {
          await saveProposal({
            id: newId("prp"),
            kind: "memory",
            title: `${fresh.length} thing${fresh.length === 1 ? "" : "s"} to remember?`,
            summary: fresh.map((d) => d.text).join(" · ").slice(0, 160),
            payload: { drafts: fresh },
            factsUsed: answer.known_data,
            hypotheses: answer.hypotheses,
            confidence: answer.confidence,
            source: outcome.source,
            brain: outcome.brain,
            status: "pending",
            createdAt: new Date().toISOString(),
            decidedAt: null,
            conversationId,
          });
        }

        const conversation = conversations.find((c) => c.id === conversationId);
        const title =
          conversation && conversation.title === "New conversation"
            ? text.slice(0, 48)
            : (conversation?.title ?? text.slice(0, 48));
        const updated: Conversation = {
          id: conversationId,
          title,
          createdAt: conversation?.createdAt ?? iso,
          updatedAt: new Date().toISOString(),
        };
        await repository.put("conversations", updated);
        setConversations((prev) => [updated, ...prev.filter((c) => c.id !== conversationId)]);
      } finally {
        setThinking(false);
      }
    },
    [activeConversationId, buildContext, conversations, newConversation, nextMoveOptions, repository, router, thinking, turns],
  );

  const planGoal = useCallback(
    async (rawGoal: string) => {
      setThinking(true);
      try {
        const outcome = await aiGoalPlan(router, buildContext("planning", turns), rawGoal);
        const plan = outcome.value;
        await saveProposal({
          id: newId("prp"),
          kind: "goal_plan",
          title: plan.destination.title,
          summary: `${plan.milestones.length} milestones · ${plan.quests.length} starting quests · ${plan.destination.duration_weeks} weeks`,
          payload: plan,
          factsUsed: plan.facts_used,
          hypotheses: plan.hypotheses,
          confidence: plan.confidence,
          source: outcome.source,
          brain: outcome.brain,
          status: "pending",
          createdAt: new Date().toISOString(),
          decidedAt: null,
          conversationId: activeConversationId,
        });
      } finally {
        setThinking(false);
      }
    },
    [activeConversationId, buildContext, router, saveProposal, turns],
  );

  const draftQuest = useCallback(
    async (intent: string, minutes: number) => {
      setThinking(true);
      try {
        const outcome = await aiQuest(router, buildContext("quest", turns), intent, minutes);
        const quest = outcome.value;
        await saveProposal({
          id: newId("prp"),
          kind: "quest",
          title: quest.quest.name,
          summary: `${quest.quest.duration_minutes} min · ${quest.quest.difficulty}`,
          payload: quest,
          factsUsed: quest.facts_used,
          hypotheses: quest.hypotheses,
          confidence: quest.confidence,
          source: outcome.source,
          brain: outcome.brain,
          status: "pending",
          createdAt: new Date().toISOString(),
          decidedAt: null,
          conversationId: activeConversationId,
        });
      } finally {
        setThinking(false);
      }
    },
    [activeConversationId, buildContext, router, saveProposal, turns],
  );

  const suggestNextMoves = useCallback(async () => {
    setThinking(true);
    try {
      return await aiNextMove(router, buildContext("next_move", turns), nextMoveOptions);
    } finally {
      setThinking(false);
    }
  }, [buildContext, nextMoveOptions, router, turns]);

  const analyzeMiss = useCallback(
    async (miss: MissAnalysisContext) => {
      setThinking(true);
      try {
        return await aiMissAnalysis(router, buildContext("miss", turns), miss);
      } finally {
        setThinking(false);
      }
    },
    [buildContext, router, turns],
  );

  const analyzeBehavior = useCallback(async () => {
    setThinking(true);
    try {
      return await aiBehaviorAnalysis(router, buildContext("analysis", turns));
    } finally {
      setThinking(false);
    }
  }, [buildContext, router, turns]);

  const setProposalStatus = useCallback(
    async (record: ProposalRecord, status: ProposalStatus) => {
      if (!repository) return;
      const next: ProposalRecord = { ...record, status, decidedAt: new Date().toISOString() };
      await repository.put("proposals", next);
      setProposals((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    },
    [repository],
  );

  const addMemory = useCallback(
    async (kind: MemoryKind, text: string) => {
      if (!repository) return;
      const record = buildMemory(newId("mem"), {
        kind,
        text,
        sourceType: kind === "USER_PREFERENCE" ? "USER" : "DETERMINISTIC_EVENT",
      });
      await repository.put("memories", record);
      setMemories((prev) => rescoreAll([record, ...prev]));
    },
    [repository],
  );

  const removeMemory = useCallback(
    async (id: string) => {
      if (!repository) return;
      await repository.remove("memories", id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    },
    [repository],
  );

  const reviseMemoryText = useCallback(
    async (id: string, text: string, reason: string) => {
      if (!repository) return;
      const previous = memories.find((m) => m.id === id);
      if (!previous) return;
      if (!isMeaningfulChange(previous, text)) return;
      // Versioning, not overwriting: the old belief stays readable.
      const { closed, next } = reviseMemory({ previous, id: newId("mem"), text, reason });
      await repository.put("memories", closed);
      await repository.put("memories", next);
      setMemories((prev) => rescoreAll([next, ...prev.map((m) => (m.id === closed.id ? closed : m))]));
    },
    [memories, repository],
  );

  const setMemoryStatus = useCallback(
    async (id: string, status: "active" | "archived") => {
      if (!repository) return;
      const record = memories.find((m) => m.id === id);
      if (!record) return;
      const next: MemoryRecord = { ...normalizeMemory(record), status, updatedAt: new Date().toISOString() };
      await repository.put("memories", next);
      setMemories((prev) => prev.map((m) => (m.id === id ? next : m)));
    },
    [memories, repository],
  );

  const setMemoryPinned = useCallback(
    async (id: string, pinned: boolean) => {
      if (!repository) return;
      const record = memories.find((m) => m.id === id);
      if (!record) return;
      const next: MemoryRecord = { ...normalizeMemory(record), pinned, updatedAt: new Date().toISOString() };
      await repository.put("memories", next);
      setMemories((prev) => rescoreAll(prev.map((m) => (m.id === id ? next : m))));
    },
    [memories, repository],
  );

  /** Folds obvious duplicates. Nothing is deleted — originals are superseded. */
  const consolidateDuplicates = useCallback(async () => {
    if (!repository) return 0;
    const groups = findDuplicates(memories);
    if (!groups.length) return 0;
    const updates = new Map<string, MemoryRecord>();
    for (const group of groups) {
      const { merged, superseded } = consolidate(group);
      updates.set(merged.id, merged);
      for (const row of superseded) updates.set(row.id, row);
    }
    for (const row of updates.values()) await repository.put("memories", row);
    setMemories((prev) => rescoreAll(prev.map((m) => updates.get(m.id) ?? m)));
    return groups.length;
  }, [memories, repository]);

  /** Persists validated behaviour patterns as memories with evidence links. */
  const refreshPatterns = useCallback(async () => {
    if (!repository || !snapshot) return 0;
    const candidates = validatedPatterns(detectPatternCandidates(snapshot.questRuns));
    if (!candidates.length) return 0;
    const existing = new Map(
      memories
        .filter((m) => m.kind === "OBSERVED_PATTERN" && m.sourceId)
        .map((m) => [m.sourceId as string, normalizeMemory(m)]),
    );
    const written: MemoryRecord[] = [];
    const newLinks: MemoryLinkRecord[] = [];
    for (const candidate of candidates) {
      const text = `${candidate.label}. ${describePattern(candidate)}`;
      const prior = existing.get(candidate.id);
      if (prior && prior.text === text) continue;
      if (prior) {
        const next: MemoryRecord = {
          ...prior,
          text,
          confidence: candidate.confidence,
          supportingEvidenceIds: candidate.evidenceIds,
          contradictions: candidate.contradictionIds,
          updatedAt: new Date().toISOString(),
        };
        await repository.put("memories", next);
        written.push(next);
        continue;
      }
      const record = buildMemory(newId("mem"), {
        kind: "OBSERVED_PATTERN",
        text,
        sourceType: "OBSERVED_PATTERN",
        sourceId: candidate.id,
        confidence: candidate.confidence,
        supportingEvidenceIds: candidate.evidenceIds,
      });
      await repository.put("memories", record);
      written.push(record);
      for (const evidenceId of candidate.evidenceIds.slice(0, 12)) {
        const link = buildLink({
          id: newId("mlk"),
          memoryId: record.id,
          relation: "derived_from",
          targetKind: "questRun",
          targetId: evidenceId,
          label: "Evidence for this pattern",
        });
        await repository.put("memoryLinks", link);
        newLinks.push(link);
      }
    }
    if (!written.length) return 0;
    setMemoryLinks((prev) => [...prev, ...newLinks]);
    setMemories((prev) => {
      const byId = new Map(written.map((row) => [row.id, row]));
      const merged = prev.map((m) => byId.get(m.id) ?? m);
      const fresh = written.filter((row) => !prev.some((m) => m.id === row.id));
      return rescoreAll([...fresh, ...merged]);
    });
    return written.length;
  }, [memories, repository, snapshot]);

  /** Applying a proposal goes through the deterministic game actions only. */
  const decideProposal = useCallback(
    async (id: string, decision: "approved" | "rejected") => {
      const record = proposals.find((p) => p.id === id);
      if (!record) return;
      if (decision === "rejected") {
        await setProposalStatus(record, "rejected");
        return;
      }
      if (record.kind === "memory") {
        // Approved suggestions become real memories here — and only here.
        const payload = record.payload as { drafts?: MemoryDraft[] };
        const rows = draftsToRecords(payload.drafts ?? [], (prefix) => newId(prefix));
        for (const row of rows) await repository?.put("memories", row);
        setMemories((prev) => rescoreAll([...rows, ...prev]));
        await setProposalStatus(record, "applied");
        return;
      }
      if (record.kind === "quest") {
        const payload = record.payload as QuestResponse;
        await game.createQuest({
          name: payload.quest.name,
          description: payload.quest.description,
          durationMinutes: payload.quest.duration_minutes,
          difficulty: payload.quest.difficulty,
          createdBy: record.source === "ai" ? "ai" : "engine",
          aiGenerated: record.source === "ai",
        });
      } else if (record.kind === "goal_plan") {
        const payload = record.payload as GoalPlanResponse;
        const destination: Destination = {
          id: newId("dst"),
          title: payload.destination.title,
          description: payload.destination.description,
          priority: payload.destination.priority,
          attributes: [],
          progress: 0,
          status: "active",
          isBoss: payload.destination.is_boss,
          bossMaxHp: payload.destination.is_boss ? 100 : 0,
          bossHp: payload.destination.is_boss ? 100 : 0,
          createdAt: new Date().toISOString(),
        };
        await game.saveDestination(destination);
        for (const quest of payload.quests) {
          await game.createQuest({
            name: quest.name,
            durationMinutes: quest.duration_minutes,
            difficulty: quest.difficulty,
            destinationId: destination.id,
            createdBy: record.source === "ai" ? "ai" : "engine",
            aiGenerated: record.source === "ai",
          });
        }
      }
      await setProposalStatus(record, "applied");
      await addMemory("APPROVED_DECISION", `You approved: ${record.title}`);
    },
    [addMemory, game, proposals, repository, setProposalStatus],
  );

  const testProvider = useCallback(
    async (id: ProviderId) => {
      const provider = router?.provider(id);
      if (!provider) return null;
      const state = await provider.testConnection();
      await patchProvider(id, {
        lastStatus: state.status as "not_connected" | "connected" | "error" | "rate_limited",
        lastTestedAt: state.testedAt ?? new Date().toISOString(),
        availableModels: state.models,
      });
      return state;
    },
    [patchProvider, router],
  );

  const loadModels = useCallback(
    async (id: ProviderId) => {
      const provider = router?.provider(id);
      if (!provider) return [];
      const models = await provider.listModels();
      await patchProvider(id, { availableModels: models });
      return models;
    },
    [patchProvider, router],
  );

  const memoryHealthReport = useMemo(() => memoryHealth({ memories }), [memories]);
  const memoryTimeline = useMemo(
    () => buildTimeline({ memories, links: memoryLinks, limit: 60 }),
    [memories, memoryLinks],
  );

  const value = useMemo<AiStoreValue>(
    () => ({
      ready,
      conversations,
      activeConversationId,
      turns,
      memories,
      memoryLinks,
      memoryHealthReport,
      memoryTimeline,
      proposals,
      pendingProposals: proposals.filter((p) => p.status === "pending" && p.kind !== "memory"),
      memoryProposals: proposals.filter((p) => p.status === "pending" && p.kind === "memory"),
      thinking,
      brainLabel: router?.activeBrainLabel("chat") ?? "Local game intelligence — no AI connected",
      providerStates: router?.states() ?? [],
      aiConnected: router?.anyConnected() ?? false,
      newConversation,
      selectConversation,
      deleteConversation,
      send,
      planGoal,
      draftQuest,
      suggestNextMoves,
      analyzeMiss,
      analyzeBehavior,
      decideProposal,
      addMemory,
      removeMemory,
      reviseMemoryText,
      setMemoryStatus,
      setMemoryPinned,
      consolidateDuplicates,
      refreshPatterns,
      testProvider,
      loadModels,
    }),
    [
      ready,
      conversations,
      activeConversationId,
      turns,
      memories,
      proposals,
      thinking,
      router,
      newConversation,
      selectConversation,
      deleteConversation,
      send,
      planGoal,
      draftQuest,
      suggestNextMoves,
      analyzeMiss,
      analyzeBehavior,
      decideProposal,
      addMemory,
      removeMemory,
      reviseMemoryText,
      setMemoryStatus,
      setMemoryPinned,
      consolidateDuplicates,
      refreshPatterns,
      memoryLinks,
      memoryHealthReport,
      memoryTimeline,
      testProvider,
      loadModels,
    ],
  );

  return <AiStoreContext.Provider value={value}>{children}</AiStoreContext.Provider>;
}

export function useAi(): AiStoreValue {
  const value = useContext(AiStoreContext);
  if (!value) throw new Error("useAi must be used inside AiStoreProvider");
  return value;
}
