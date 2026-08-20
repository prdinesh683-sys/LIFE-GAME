import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getLocalRepository } from "../data/indexeddb-repository";
import type { LocalRepository } from "../data/repository";
import {
  createAttributes,
  createBoosts,
  createDestination,
  createDeviceId,
  createDrains,
  createProfile,
  createSettings,
} from "../data/seed";
import { buildPersonalContext, type PersonalContext } from "../ai/personal-context-service";
import { AIRouter } from "../ai/router";
import type { ProviderId } from "../ai/types";
import { proposalToBlueprint, type BlueprintProposal } from "../game/blueprint-parser";
import { buildMissContext, detectPatterns } from "../game/behavior-engine";
import { computeMomentum, type MomentumBreakdown } from "../game/momentum-engine";
import { advanceRun, dayKey } from "../game/run-engine";
import { canTransition, materialiseQuest, newId, type QuestDraft } from "../game/quest-engine";
import { rankProgress, resolveReward, type RankProgress } from "../game/reward-engine";
import { currentSlot, windowStatusFor, type TimeWindow } from "../game/time-window";
import { planDropForToday, planReschedule, planSmallerVersion, type RecoveryKind } from "../game/miss-recovery";
import type {
  ActivityEvent,
  ActivityEventType,
  AiProviderSettings,
  AttributeKey,
  Boost,
  DailyState,
  Destination,
  Drain,
  GameSnapshot,
  MissReason,
  Quest,
  QuestRun,
  Settings,
  Trophy,
  VerificationStatus,
} from "../game/types";
import { SCHEMA_VERSION } from "../game/types";

export interface CompletionResult {
  sparks: number;
  combo: number;
  surge: boolean;
  rankUp: boolean;
  rank: number;
  runMilestone: number | null;
  trophy: Trophy | null;
}

interface GameStoreValue {
  ready: boolean;
  error: string | null;
  snapshot: GameSnapshot | null;
  momentum: MomentumBreakdown;
  rank: RankProgress;
  today: DailyState | null;
  activeRun: QuestRun | null;
  needsRecovery: boolean;
  patterns: { id: string; label: string; detail: string }[];
  router: AIRouter | null;
  context: PersonalContext | null;
  /** Storage boundary — AI-side records (chat, memories, proposals) use this. */
  repository: LocalRepository | null;
  /** Records a real handshake result / usage counter for one AI provider. */
  patchProvider: (id: ProviderId, patch: Partial<AiProviderSettings>) => Promise<void>;
  countProviderRequest: (id: ProviderId) => Promise<void>;
  approveBlueprint: (rawInput: string, proposal: BlueprintProposal) => Promise<void>;
  updateDailyState: (patch: Partial<Omit<DailyState, "id" | "updatedAt">>) => Promise<void>;
  createQuest: (draft: QuestDraft) => Promise<Quest>;
  startQuest: (
    questId: string,
    options?: { rushRequested?: boolean; recoveryOfRunId?: string | null },
  ) => Promise<QuestRun>;
  /** Optional part of the day for a quest. null clears it back to anytime. */
  setQuestWindow: (questId: string, timeWindow: TimeWindow | null) => Promise<void>;
  /** Records the first Today load of a new day. */
  openDay: () => Promise<void>;
  /** Records the player closing the day. */
  closeDay: () => Promise<void>;
  /** Deterministic way back after a miss. Returns the new quest when one is made. */
  recoverFromMiss: (runId: string, kind: RecoveryKind) => Promise<Quest | null>;
  completeQuest: (runId: string, verification: VerificationStatus) => Promise<CompletionResult>;
  missQuest: (runId: string, reason: MissReason, note: string) => Promise<void>;
  abandonRun: (runId: string) => Promise<void>;
  logBoost: (boostId: string) => Promise<void>;
  logDrain: (drainId: string) => Promise<void>;
  saveBoost: (boost: Boost) => Promise<void>;
  removeBoost: (id: string) => Promise<void>;
  saveDrain: (drain: Drain) => Promise<void>;
  removeDrain: (id: string) => Promise<void>;
  saveDestination: (destination: Destination) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  exportData: () => Promise<string>;
  importData: (json: string) => Promise<void>;
  wipeData: () => Promise<void>;
}

const GameStoreContext = createContext<GameStoreValue | null>(null);

const EMPTY_MOMENTUM: MomentumBreakdown = {
  value: 0,
  completions: 0,
  misses: 0,
  hoursSinceLastAction: null,
  label: "Dormant",
};

const DIFFICULTY_WEIGHT: Record<string, number> = {
  trivial: 0.6,
  easy: 0.8,
  normal: 1,
  hard: 1.25,
  extreme: 1.5,
};

export function GameStoreProvider({ children }: { children: ReactNode }) {
  const [repo, setRepo] = useState<LocalRepository | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowIso, setNowIso] = useState(() => new Date(0).toISOString());

  // Bootstrap is client-only: IndexedDB does not exist during SSR.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repository = getLocalRepository();
        await repository.init();
        let loaded = await repository.loadSnapshot();
        if (!loaded) {
          const iso = new Date().toISOString();
          await repository.put("profile", createProfile(iso));
          await repository.put("settings", createSettings(createDeviceId()));
          await repository.putMany("attributes", createAttributes());
          loaded = await repository.loadSnapshot();
        }
        if (cancelled) return;
        setRepo(repository);
        setSnapshot(loaded);
        setNowIso(new Date().toISOString());
        setReady(true);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Local storage unavailable");
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Momentum decays with time, so refresh the clock periodically.
  useEffect(() => {
    const timer = setInterval(() => setNowIso(new Date().toISOString()), 60000);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(
    async (repository: LocalRepository) => {
      const next = await repository.loadSnapshot();
      setSnapshot(next);
      setNowIso(new Date().toISOString());
    },
    [],
  );

  const requireRepo = useCallback(() => {
    if (!repo) throw new Error("Local storage is not ready yet.");
    return repo;
  }, [repo]);

  const requireSnapshot = useCallback(() => {
    if (!snapshot) throw new Error("Game state is not ready yet.");
    return snapshot;
  }, [snapshot]);

  const recordEvent = useCallback(
    async (
      repository: LocalRepository,
      current: GameSnapshot,
      type: ActivityEventType,
      payload: Record<string, unknown>,
    ) => {
      const event: ActivityEvent = {
        id: newId("evt"),
        deviceId: current.settings.deviceId,
        timestamp: new Date().toISOString(),
        type,
        schemaVersion: SCHEMA_VERSION,
        payload,
      };
      await repository.put("events", event);
    },
    [],
  );

  const momentum = useMemo(() => {
    if (!snapshot) return EMPTY_MOMENTUM;
    return computeMomentum({
      config: snapshot.settings.economy,
      events: snapshot.events,
      today: snapshot.dailyStates.find((d) => d.id === dayKey()) ?? null,
      nowIso,
    });
  }, [snapshot, nowIso]);

  const rank = useMemo(() => {
    if (!snapshot) return { rank: 1, intoRank: 0, needed: 120, ratio: 0 };
    return rankProgress(snapshot.settings.economy, snapshot.profile.lifetimeSparks);
  }, [snapshot]);

  const today = useMemo(
    () => snapshot?.dailyStates.find((d) => d.id === dayKey()) ?? null,
    [snapshot],
  );

  const activeRun = useMemo(
    () => snapshot?.questRuns.find((r) => r.outcome === "in_progress") ?? null,
    [snapshot],
  );

  const needsRecovery = useMemo(() => {
    if (!snapshot) return false;
    const recent = [...snapshot.questRuns]
      .filter((r) => r.outcome !== "in_progress")
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    return recent?.outcome === "missed";
  }, [snapshot]);

  const patterns = useMemo(
    () => (snapshot ? detectPatterns(snapshot.questRuns, snapshot.events) : []),
    [snapshot],
  );

  const providerKey = (id: ProviderId) =>
    id === "phone_local" ? ("phoneLocal" as const) : id === "ollama" ? ("ollama" as const) : ("cloud" as const);

  const patchProvider = useCallback(
    async (id: ProviderId, patch: Partial<AiProviderSettings>) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const key = providerKey(id);
      const settings: Settings = {
        ...current.settings,
        ai: {
          ...current.settings.ai,
          [key]: { ...current.settings.ai[key], ...patch },
        },
      };
      // updatedAt is the sync touch time; AI provider settings never leave the device.
      await repository.put("settings", { ...settings, updatedAt: new Date().toISOString() });
      await refresh(repository);
    },
    [refresh, requireRepo, requireSnapshot],
  );

  const countProviderRequest = useCallback(
    async (id: ProviderId) => {
      const current = requireSnapshot();
      const key = providerKey(id);
      const provider = current.settings.ai[key];
      const day = dayKey();
      await patchProvider(id, {
        requestsDay: day,
        requestsToday: (provider.requestsDay === day ? (provider.requestsToday ?? 0) : 0) + 1,
      });
    },
    [patchProvider, requireSnapshot],
  );

  const router = useMemo(
    () =>
      snapshot
        ? new AIRouter(snapshot.settings, {
            onState: (id, patch) => {
              void patchProvider(id, patch);
            },
            onUsage: (id) => {
              void countProviderRequest(id);
            },
          })
        : null,
    [snapshot, patchProvider, countProviderRequest],
  );

  const context = useMemo(
    () => (snapshot ? buildPersonalContext(snapshot, momentum.value) : null),
    [snapshot, momentum.value],
  );

  const approveBlueprint = useCallback(
    async (rawInput: string, proposal: BlueprintProposal) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const iso = new Date().toISOString();

      const blueprint = proposalToBlueprint(rawInput, proposal, iso);
      blueprint.approved = true;
      blueprint.approvedAt = iso;
      blueprint.updatedAt = iso;
      await repository.put("blueprint", blueprint);

      const drains = createDrains(proposal.drainNames, iso);
      const boosts = createBoosts(proposal.boostCategories, iso);
      for (const boost of boosts) {
        const match = drains.find((d) => d.replacement === boost.name);
        if (match) boost.replacesDrainId = match.id;
      }
      await repository.putMany("drains", drains);
      await repository.putMany("boosts", boosts);

      const { destination, milestones } = createDestination(proposal, iso);
      await repository.put("destinations", destination);
      await repository.putMany("milestones", milestones);

      const firstBoost = boosts[0];
      const firstQuest = materialiseQuest(
        current.settings.economy,
        {
          name: firstBoost ? `${firstBoost.name} — first move` : "Take your first real action",
          description:
            firstBoost?.minimumVersion ?? "One small real-world action. That's the whole quest.",
          category: firstBoost?.category ?? "movement",
          durationMinutes: Math.min(15, firstBoost?.durationMinutes ?? 10),
          difficulty: "easy",
          attribute: firstBoost?.attribute ?? "vitality",
          destinationId: destination.id,
          boostId: firstBoost?.id ?? null,
          createdBy: "engine",
        },
        iso,
      );
      await repository.put("quests", firstQuest);

      await repository.put("settings", {
        ...current.settings,
        onboardingComplete: true,
        updatedAt: iso,
      });
      await recordEvent(repository, current, "blueprint_approved", {
        goals: proposal.goals.length,
      });
      await refresh(repository);
    },
    [recordEvent, refresh, requireRepo, requireSnapshot],
  );

  const updateDailyState = useCallback(
    async (patch: Partial<Omit<DailyState, "id" | "updatedAt">>) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const key = dayKey();
      const existing = current.dailyStates.find((d) => d.id === key);
      const next: DailyState = {
        id: key,
        energy: patch.energy ?? existing?.energy ?? 3,
        mood: patch.mood ?? existing?.mood ?? 3,
        availableMinutes: patch.availableMinutes ?? existing?.availableMinutes ?? 30,
        note: patch.note ?? existing?.note ?? "",
        updatedAt: new Date().toISOString(),
        openedAt: existing?.openedAt ?? null,
        closedAt: existing?.closedAt ?? null,
      };
      await repository.put("dailyStates", next);
      await refresh(repository);
    },
    [refresh, requireRepo, requireSnapshot],
  );

  const createQuest = useCallback(
    async (draft: QuestDraft) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const quest = materialiseQuest(current.settings.economy, draft, new Date().toISOString());
      await repository.put("quests", quest);
      await refresh(repository);
      return quest;
    },
    [refresh, requireRepo, requireSnapshot],
  );

  const startQuest = useCallback(
    async (questId: string, options?: { rushRequested?: boolean; recoveryOfRunId?: string | null }) => {
      const repository = requireRepo();
      // Read straight from storage: a quest created moments ago in the same
      // handler is not in React state yet (refresh is async).
      const current = (await repository.loadSnapshot()) ?? requireSnapshot();
      const quest = current.quests.find((q) => q.id === questId);
      if (!quest) throw new Error("Quest not found.");
      if (!quest.approved) throw new Error("This quest still needs your approval.");
      if (!canTransition(quest.status, "active")) throw new Error("This quest cannot be started.");

      // Only one real-world activity at a time.
      for (const run of current.questRuns.filter((r) => r.outcome === "in_progress")) {
        await repository.put("questRuns", { ...run, outcome: "missed", endedAt: new Date().toISOString() });
        const stale = current.quests.find((q) => q.id === run.questId);
        if (stale) await repository.put("quests", { ...stale, status: "available" });
      }

      const startedAt = new Date().toISOString();
      const run: QuestRun = {
        id: newId("run"),
        questId: quest.id,
        questName: quest.name,
        startedAt,
        endedAt: null,
        outcome: "in_progress",
        verification: "unverified",
        sparksAwarded: 0,
        comboAtCompletion: 0,
        rushRequested: options?.rushRequested ?? quest.type === "rush",
        rushHit: null,
        missReason: null,
        missNote: null,
        energyAtStart: today?.energy ?? null,
        moodAtStart: today?.mood ?? null,
        momentumAtStart: momentum.value,
        // Timing context only — reward and momentum maths never read these.
        windowAtStart: currentSlot(startedAt),
        windowStatus: windowStatusFor(quest, startedAt),
        recoveryOfRunId: options?.recoveryOfRunId ?? null,
      };
      await repository.put("questRuns", run);
      await repository.put("quests", { ...quest, status: "active" });
      await recordEvent(repository, current, "quest_started", { questId: quest.id });
      await refresh(repository);
      return run;
    },
    [momentum.value, recordEvent, refresh, requireRepo, requireSnapshot, today],
  );

  const completeQuest = useCallback(
    async (runId: string, verification: VerificationStatus) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const run = current.questRuns.find((r) => r.id === runId);
      if (!run) throw new Error("Quest run not found.");
      if (run.outcome !== "in_progress") throw new Error("This run is already resolved.");
      const quest = current.quests.find((q) => q.id === run.questId);
      if (!quest) throw new Error("Quest not found.");

      const iso = new Date().toISOString();
      const config = current.settings.economy;

      const reward = resolveReward({
        config,
        profile: current.profile,
        durationMinutes: quest.durationMinutes,
        difficulty: quest.difficulty,
        lastCompletionIso: current.profile.comboUpdatedAt,
        nowIso: iso,
      });

      const runOutcome = advanceRun(config, current.profile);

      await repository.put("questRuns", {
        ...run,
        endedAt: iso,
        outcome: "completed",
        verification,
        sparksAwarded: reward.totalSparks,
        comboAtCompletion: reward.combo,
        rushHit: run.rushRequested ? true : null,
      });
      await repository.put("quests", { ...quest, status: "completed", verification });

      await repository.put("profile", {
        ...current.profile,
        sparks: current.profile.sparks + reward.totalSparks,
        lifetimeSparks: current.profile.lifetimeSparks + reward.totalSparks,
        rank: reward.rankAfter,
        combo: reward.combo,
        comboUpdatedAt: iso,
        currentRun: runOutcome.currentRun,
        bestRun: runOutcome.bestRun,
        lastActiveDay: dayKey(),
      });

      const attribute = current.attributes.find((a) => a.id === quest.attribute);
      await repository.put("attributes", {
        id: quest.attribute,
        points: (attribute?.points ?? 0) + config.attributePointsPerQuest,
      });

      if (quest.destinationId) {
        const destination = current.destinations.find((d) => d.id === quest.destinationId);
        if (destination) {
          const gain = Math.min(100 - destination.progress, Math.max(2, Math.round(quest.durationMinutes / 5)));
          await repository.put("destinations", {
            ...destination,
            progress: destination.progress + gain,
            bossHp: Math.max(0, destination.bossHp - gain),
            status: destination.progress + gain >= 100 ? "completed" : destination.status,
          });
        }
      }

      let trophy: Trophy | null = null;
      if (quest.isRecovery) {
        trophy = {
          id: newId("trophy"),
          name: "Comeback",
          description: "Returned right after a miss instead of stopping.",
          icon: "shield-check",
          earnedAt: iso,
        };
      } else if (runOutcome.milestone) {
        trophy = {
          id: newId("trophy"),
          name: `Run of ${runOutcome.milestone}`,
          description: `${runOutcome.milestone} days of real activity.`,
          icon: "flame",
          earnedAt: iso,
        };
      } else if (reward.rankUp) {
        trophy = {
          id: newId("trophy"),
          name: `Rank ${reward.rankAfter}`,
          description: "Reached a new Rank.",
          icon: "trophy",
          earnedAt: iso,
        };
      }
      if (trophy) {
        const already = current.trophies.some((t) => t.name === trophy?.name);
        if (already) trophy = null;
        else await repository.put("trophies", trophy);
      }

      await recordEvent(repository, current, quest.isRecovery ? "recovery_completed" : "quest_completed", {
        questId: quest.id,
        sparks: reward.totalSparks,
        difficultyWeight: DIFFICULTY_WEIGHT[quest.difficulty] ?? 1,
        verification,
      });
      if (trophy) await recordEvent(repository, current, "trophy_earned", { name: trophy.name });
      if (reward.rankUp) await recordEvent(repository, current, "rank_up", { rank: reward.rankAfter });

      await refresh(repository);

      return {
        sparks: reward.totalSparks,
        combo: reward.combo,
        surge: reward.surge,
        rankUp: reward.rankUp,
        rank: reward.rankAfter,
        runMilestone: runOutcome.milestone,
        trophy,
      };
    },
    [recordEvent, refresh, requireRepo, requireSnapshot],
  );

  const missQuest = useCallback(
    async (runId: string, reason: MissReason, note: string) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const run = current.questRuns.find((r) => r.id === runId);
      if (!run) throw new Error("Quest run not found.");
      const quest = current.quests.find((q) => q.id === run.questId);
      const iso = new Date().toISOString();

      const resolved: QuestRun = {
        ...run,
        endedAt: iso,
        outcome: "missed",
        missReason: reason,
        missNote: note.trim() || null,
        rushHit: run.rushRequested ? false : null,
      };
      await repository.put("questRuns", resolved);
      if (quest) await repository.put("quests", { ...quest, status: "available" });

      // The miss becomes structured learning data, not a punishment.
      const analysis = buildMissContext({
        run: resolved,
        runs: current.questRuns,
        momentum: momentum.value,
      });
      await repository.put("aiAnalyses", {
        id: newId("miss"),
        kind: "missed_quest_context",
        createdAt: iso,
        analyzedBy: "pending",
        context: { ...analysis, durationMinutes: quest?.durationMinutes ?? 0, difficulty: quest?.difficulty ?? "normal" },
      });

      await recordEvent(repository, current, "quest_missed", {
        questId: run.questId,
        reason,
      });
      await refresh(repository);
    },
    [momentum.value, recordEvent, refresh, requireRepo, requireSnapshot],
  );

  const setQuestWindow = useCallback(
    async (questId: string, timeWindow: TimeWindow | null) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const quest = current.quests.find((q) => q.id === questId);
      if (!quest) throw new Error("Quest not found.");
      await repository.put("quests", { ...quest, timeWindow });
      await refresh(repository);
    },
    [refresh, requireRepo, requireSnapshot],
  );

  const touchDay = useCallback(
    async (patch: { openedAt?: string; closedAt?: string }) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const key = dayKey();
      const existing = current.dailyStates.find((d) => d.id === key);
      const next: DailyState = {
        id: key,
        energy: existing?.energy ?? 3,
        mood: existing?.mood ?? 3,
        availableMinutes: existing?.availableMinutes ?? 30,
        note: existing?.note ?? "",
        updatedAt: new Date().toISOString(),
        openedAt: patch.openedAt ?? existing?.openedAt ?? null,
        closedAt: patch.closedAt ?? existing?.closedAt ?? null,
      };
      await repository.put("dailyStates", next);
      await refresh(repository);
    },
    [refresh, requireRepo, requireSnapshot],
  );

  const openDay = useCallback(async () => {
    const key = dayKey();
    const existing = snapshot?.dailyStates.find((d) => d.id === key);
    if (existing?.openedAt) return;
    await touchDay({ openedAt: new Date().toISOString() });
  }, [snapshot, touchDay]);

  const closeDay = useCallback(async () => {
    await touchDay({ closedAt: new Date().toISOString() });
  }, [touchDay]);

  /**
   * Recovery after a miss. The choice is decided by the deterministic
   * miss-recovery rules; this only performs the writes they describe.
   */
  const recoverFromMiss = useCallback(
    async (runId: string, kind: RecoveryKind) => {
      const repository = requireRepo();
      const current = (await repository.loadSnapshot()) ?? requireSnapshot();
      const run = current.questRuns.find((r) => r.id === runId);
      if (!run) throw new Error("That run is no longer available.");
      const quest = current.quests.find((q) => q.id === run.questId);
      if (!quest) throw new Error("Quest not found.");
      const nowIso = new Date().toISOString();

      if (kind === "smaller") {
        const plan = planSmallerVersion({ quest, run });
        const smaller = materialiseQuest(current.settings.economy, plan.draft, nowIso);
        await repository.put("quests", smaller);
        await refresh(repository);
        await startQuest(smaller.id, { recoveryOfRunId: plan.recoveryOfRunId });
        return smaller;
      }

      if (kind === "reschedule") {
        await repository.put("quests", planReschedule(quest, nowIso).quest);
        await refresh(repository);
        return null;
      }

      await repository.put("quests", planDropForToday(quest, nowIso).quest);
      await refresh(repository);
      return null;
    },
    [refresh, requireRepo, requireSnapshot, startQuest],
  );

  const abandonRun = useCallback(
    async (runId: string) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const run = current.questRuns.find((r) => r.id === runId);
      if (!run) return;
      await repository.remove("questRuns", runId);
      const quest = current.quests.find((q) => q.id === run.questId);
      if (quest) await repository.put("quests", { ...quest, status: "available" });
      await refresh(repository);
    },
    [refresh, requireRepo, requireSnapshot],
  );

  const logBoost = useCallback(
    async (boostId: string) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      const boost = current.boosts.find((b) => b.id === boostId);
      if (!boost) throw new Error("Boost not found.");
      await recordEvent(repository, current, "boost_logged", {
        boostId,
        difficultyWeight: DIFFICULTY_WEIGHT[boost.difficulty] ?? 1,
      });
      await refresh(repository);
    },
    [recordEvent, refresh, requireRepo, requireSnapshot],
  );

  const logDrain = useCallback(
    async (drainId: string) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      await recordEvent(repository, current, "drain_logged", { drainId });
      await refresh(repository);
    },
    [recordEvent, refresh, requireRepo, requireSnapshot],
  );

  const saveBoost = useCallback(
    async (boost: Boost) => {
      const repository = requireRepo();
      await repository.put("boosts", boost);
      await refresh(repository);
    },
    [refresh, requireRepo],
  );

  const removeBoost = useCallback(
    async (id: string) => {
      const repository = requireRepo();
      await repository.remove("boosts", id);
      await refresh(repository);
    },
    [refresh, requireRepo],
  );

  const saveDrain = useCallback(
    async (drain: Drain) => {
      const repository = requireRepo();
      await repository.put("drains", drain);
      await refresh(repository);
    },
    [refresh, requireRepo],
  );

  const removeDrain = useCallback(
    async (id: string) => {
      const repository = requireRepo();
      await repository.remove("drains", id);
      await refresh(repository);
    },
    [refresh, requireRepo],
  );

  const saveDestination = useCallback(
    async (destination: Destination) => {
      const repository = requireRepo();
      await repository.put("destinations", destination);
      await refresh(repository);
    },
    [refresh, requireRepo],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const repository = requireRepo();
      const current = requireSnapshot();
      await repository.put("settings", {
        ...current.settings,
        ...patch,
        id: "settings",
        updatedAt: new Date().toISOString(),
      });
      await refresh(repository);
    },
    [refresh, requireRepo, requireSnapshot],
  );

  const exportData = useCallback(async () => {
    const repository = requireRepo();
    const data = await repository.exportAll();
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
  }, [requireRepo]);

  const importData = useCallback(
    async (json: string) => {
      const repository = requireRepo();
      const parsed = JSON.parse(json) as { data?: Record<string, unknown[]> };
      if (!parsed.data) throw new Error("This file does not look like a Life Game export.");
      await repository.importAll(parsed.data);
      await refresh(repository);
    },
    [refresh, requireRepo],
  );

  const wipeData = useCallback(async () => {
    const repository = requireRepo();
    await repository.clearAll();
    const iso = new Date().toISOString();
    await repository.put("profile", createProfile(iso));
    await repository.put("settings", createSettings(createDeviceId()));
    await repository.putMany("attributes", createAttributes());
    await refresh(repository);
  }, [refresh, requireRepo]);

  const value = useMemo<GameStoreValue>(
    () => ({
      ready,
      error,
      snapshot,
      momentum,
      rank,
      today,
      activeRun,
      needsRecovery,
      patterns,
      router,
      context,
      repository: repo,
      patchProvider,
      countProviderRequest,
      approveBlueprint,
      updateDailyState,
      createQuest,
      startQuest,
      setQuestWindow,
      openDay,
      closeDay,
      recoverFromMiss,
      completeQuest,
      missQuest,
      abandonRun,
      logBoost,
      logDrain,
      saveBoost,
      removeBoost,
      saveDrain,
      removeDrain,
      saveDestination,
      updateSettings,
      exportData,
      importData,
      wipeData,
    }),
    [
      ready,
      error,
      snapshot,
      momentum,
      rank,
      today,
      activeRun,
      needsRecovery,
      patterns,
      router,
      context,
      repo,
      patchProvider,
      countProviderRequest,
      approveBlueprint,
      updateDailyState,
      createQuest,
      startQuest,
      setQuestWindow,
      openDay,
      closeDay,
      recoverFromMiss,
      completeQuest,
      missQuest,
      abandonRun,
      logBoost,
      logDrain,
      saveBoost,
      removeBoost,
      saveDrain,
      removeDrain,
      saveDestination,
      updateSettings,
      exportData,
      importData,
      wipeData,
    ],
  );

  return <GameStoreContext.Provider value={value}>{children}</GameStoreContext.Provider>;
}

export function useGame(): GameStoreValue {
  const value = useContext(GameStoreContext);
  if (!value) throw new Error("useGame must be used inside GameStoreProvider");
  return value;
}

export function attributeLabelPoints(
  snapshot: GameSnapshot | null,
  key: AttributeKey,
): number {
  return snapshot?.attributes.find((a) => a.id === key)?.points ?? 0;
}