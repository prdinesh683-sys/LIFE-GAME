import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { aiAdvise, aiAssessChange } from "../ai/ai-service";
import { buildPersonalContext, layersForJob } from "../ai/personal-context-service";
import { readDriveContextForAi } from "../sync/drive-context-bridge";
import {
  assembleRecommendations,
  draftsFromAdvisorResponse,
  localDrafts,
  MAX_LIVE_RECOMMENDATIONS,
} from "../advisor/advisor-engine";
import { buildAdvisorFacts, type AdvisorFacts } from "../advisor/advisor-facts";
import { isDueForMeasurement, measureOutcome, summariseOutcomes } from "../advisor/advisor-outcomes";
import { assessMaterialChanges } from "../advisor/advisor-assessment";
import {
  materialSnapshotOf,
  suppressedSignatures,
} from "../advisor/advisor-feedback";
import { detectTriggers, type AdvisorTrigger } from "../advisor/advisor-triggers";
import type {
  DecisionFeedbackRecord,
  RecommendationAction,
  RecommendationHistoryRecord,
  RecommendationOutcomeRecord,
  RecommendationRecord,
} from "../advisor/advisor-types";
import { checkStale, validateRecommendation } from "../advisor/advisor-validation";
import {
  approvalsByActionType,
  grantTrust,
  isTrusted,
  revokeTrust,
  shouldOfferTrust,
  streamlineDecision,
  trustLabel,
  type TrustGrant,
} from "../advisor/action-trust";
import { permissionOf } from "../agent/action-registry";
import type { AgentAction, PermissionClass } from "../agent/agent-types";
import { newId } from "../game/quest-engine";
import { generateNextMoves } from "../game/recommendation-engine";
import { dayKey } from "../game/run-engine";
import { useAi } from "./ai-store";
import { useGame } from "./game-store";


/**
 * ADVISOR STORE — Phase 4A.
 *
 * Owns recommendation records, their approval lifecycle, and their measured
 * outcomes. It never writes game state: applying an approved recommendation
 * calls the same deterministic game-store actions the manual UI uses, and only
 * after a fresh deterministic revalidation.
 */

/** Proactive limit: no automatic regeneration inside this window. */
export const ADVISOR_COOLDOWN_MINUTES = 30;

export type ApproveResult =
  | { ok: true; applied: true }
  | { ok: false; needsReapproval: true; reason: "state_changed" | "expired" }
  | { ok: false; needsReapproval: false; problems: string[] };

interface AdvisorStoreValue {
  ready: boolean;
  facts: AdvisorFacts | null;
  triggers: AdvisorTrigger[];
  live: RecommendationRecord[];
  past: RecommendationRecord[];
  outcomes: RecommendationOutcomeRecord[];
  history: RecommendationHistoryRecord[];
  memoryLines: string[];
  generating: boolean;
  note: string | null;
  brainLabel: string;
  canGenerate: boolean;
  generate: (force?: boolean) => Promise<void>;
  approve: (
    id: string,
    options?: { force?: boolean; reason?: string; optionId?: string },
  ) => Promise<ApproveResult>;
  reject: (id: string, reason?: string) => Promise<void>;
  measureDue: () => Promise<number>;
  /** Explicit user action — the only path that may reach a cloud brain. */
  assessWithCloud: () => Promise<void>;
  outcomeFor: (recommendationId: string) => RecommendationOutcomeRecord | null;
  historyFor: (recommendationId: string) => RecommendationHistoryRecord[];
  /** Streamlined approval (remembered trust). */
  trustGrants: TrustGrant[];
  /** True when this recommendation may be approved in one tap. */
  isStreamlined: (record: RecommendationRecord) => boolean;
  /** Non-null when the player has approved this kind often enough to be offered trust. */
  trustOfferFor: (record: RecommendationRecord) => { actionType: string; label: string } | null;
  grantActionTrust: (actionType: string, permission: PermissionClass) => Promise<void>;
  revokeActionTrust: (actionType: string) => Promise<void>;
}

/** Recommendation actions reuse the agent registry's permission classes. */
export function permissionForAction(action: RecommendationAction): PermissionClass {
  if (action.type === "none") return "READ";
  return permissionOf(action as unknown as AgentAction);
}


const AdvisorContext = createContext<AdvisorStoreValue | null>(null);

export function AdvisorStoreProvider({ children }: { children: ReactNode }) {
  const game = useGame();
  const ai = useAi();
  const { repository, router, snapshot, momentum } = game;

  const [records, setRecords] = useState<RecommendationRecord[]>([]);
  const [outcomes, setOutcomes] = useState<RecommendationOutcomeRecord[]>([]);
  const [history, setHistory] = useState<RecommendationHistoryRecord[]>([]);
  const [generating, setGenerating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    void (async () => {
      const [recs, outs, hist] = await Promise.all([
        repository.list("recommendations"),
        repository.list("recommendationOutcomes"),
        repository.list("recommendationHistory"),
      ]);
      if (cancelled) return;
      setRecords(sortDesc(recs));
      setOutcomes(outs);
      setHistory(hist);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const facts = useMemo(
    () => (snapshot ? buildAdvisorFacts(snapshot, momentum.value) : null),
    [snapshot, momentum.value],
  );
  const triggers = useMemo(() => (facts ? detectTriggers(facts) : []), [facts]);

  const log = useCallback(
    async (recommendationId: string, event: RecommendationHistoryRecord["event"], detail: string) => {
      if (!repository) return;
      const entry: RecommendationHistoryRecord = {
        id: newId("rhs"),
        recommendationId,
        event,
        detail,
        at: new Date().toISOString(),
      };
      await repository.put("recommendationHistory", entry);
      setHistory((prev) => [entry, ...prev]);
    },
    [repository],
  );

  const save = useCallback(
    async (record: RecommendationRecord) => {
      if (!repository) return;
      // updatedAt is what sync compares, so every local write claims the newer
      // timestamp and a remote copy can never silently undo a decision here.
      const stamped: RecommendationRecord = { ...record, updatedAt: new Date().toISOString() };
      await repository.put("recommendations", stamped);
      setRecords((prev) => sortDesc([stamped, ...prev.filter((r) => r.id !== stamped.id)]));
    },
    [repository],
  );

  /** Expiry is deterministic and silent — stale advice never lingers. */
  useEffect(() => {
    if (!ready || !repository) return;
    const now = Date.now();
    const expired = records.filter(
      (r) =>
        (r.status === "pending" || r.status === "needs_reapproval") &&
        Date.parse(r.expiresAt) <= now,
    );
    if (!expired.length) return;
    void (async () => {
      for (const record of expired) {
        await save({ ...record, status: "expired" });
        await log(record.id, "expired", "The situation it was based on is no longer current.");
      }
    })();
  }, [ready, records, repository, save, log]);

  /**
   * Hybrid material-change check. The deterministic layer proves the change; an
   * *allowed* brain may only veto it. Cloud assessment never runs from a passive
   * state change — it needs the explicit "Re-check with cloud AI" action.
   */
  const checkingRef = useRef(false);
  const runAssessment = useCallback(
    async (requestedByUser: boolean) => {
      if (!ready || !repository || !facts || !snapshot || checkingRef.current) return null;
      const candidates = records.filter(
        (r) => r.status === "pending" && Date.parse(r.expiresAt) > Date.now(),
      );
      if (!candidates.length) return null;
      checkingRef.current = true;
      try {
        const brainId = router?.activeBrain("analysis")?.id ?? null;
        const minimal = brainId === "cloud";
        const context = buildPersonalContext(snapshot, momentum.value, {
          layers: layersForJob("analysis"),
          memories: ai.memories,
          minimal,
          vault: minimal ? null : readDriveContextForAi(),
        });
        const run = await assessMaterialChanges({
          records: candidates,
          facts,
          brainId,
          requestedByUser,
          assess: async (record, changes) => {
            const verdict = await aiAssessChange(
              router,
              context,
              {
                title: record.title,
                summary: record.summary,
                expectedOutcome: record.expectedOutcome,
              },
              changes.map((c) => ({ label: c.label, detail: c.detail })),
            );
            return verdict.value ?? null;
          },
        });
        for (const { record, changes } of run.updates) {
          const revalidated = validateRecommendation({
            action: record.action,
            facts,
            blueprint: snapshot.blueprint,
          });
          await save({
            ...record,
            status: "needs_reapproval",
            action: revalidated.action,
            validation: revalidated.report,
            materialSnapshot: materialSnapshotOf(facts),
          });
          await log(
            record.id,
            "revalidated",
            `Your situation changed: ${changes.map((c) => c.detail).join(" ")} ${run.note}`,
          );
        }
        return run;
      } finally {
        checkingRef.current = false;
      }
    },
    [ai.memories, facts, log, momentum.value, ready, records, repository, router, save, snapshot],
  );

  /** Passive path: deterministic only (plus a local brain, which never leaves the device). */
  useEffect(() => {
    void runAssessment(false);
  }, [runAssessment]);

  /** Explicit user action — the only way a cloud assessment ever happens. */
  const assessWithCloud = useCallback(async () => {
    const run = await runAssessment(true);
    setNote(run ? run.note : "Nothing open needs re-checking right now.");
  }, [runAssessment]);


  const live = useMemo(
    () =>
      records.filter(
        (r) =>
          (r.status === "pending" || r.status === "needs_reapproval") &&
          Date.parse(r.expiresAt) > Date.now(),
      ),
    [records],
  );
  const past = useMemo(() => records.filter((r) => !live.includes(r)), [records, live]);

  const lastGeneratedAt = useMemo(
    () => records.map((r) => Date.parse(r.createdAt)).sort((a, b) => b - a)[0] ?? null,
    [records],
  );

  const canGenerate =
    live.length < MAX_LIVE_RECOMMENDATIONS &&
    (lastGeneratedAt == null || Date.now() - lastGeneratedAt > ADVISOR_COOLDOWN_MINUTES * 60_000);

  const nextMoveOptions = useMemo(() => {
    if (!snapshot) return [];
    return generateNextMoves({
      config: snapshot.settings.economy,
      boosts: snapshot.boosts,
      destinations: snapshot.destinations,
      runs: snapshot.questRuns,
      today: snapshot.dailyStates.find((d) => d.id === dayKey()) ?? null,
      momentum: momentum.value,
      blueprint: snapshot.blueprint,
      needsRecovery: game.needsRecovery,
      seed: Date.parse(dayKey()),
    });
  }, [snapshot, momentum.value, game.needsRecovery]);

  const memoryLines = useMemo(() => summariseOutcomes(outcomes), [outcomes]);

  const generate = useCallback(
    async (force = false) => {
      if (!snapshot || !facts || generating) return;
      if (!force && live.length >= MAX_LIVE_RECOMMENDATIONS) {
        setNote("You already have open recommendations. Decide on those first.");
        return;
      }
      setGenerating(true);
      setNote(null);
      try {
        const minimal = router?.activeBrain("analysis")?.id === "cloud";
        const context = buildPersonalContext(snapshot, momentum.value, {
          layers: layersForJob("analysis"),
          memories: ai.memories,
          minimal,
          vault: minimal ? null : readDriveContextForAi(),
        });
        const vault = minimal ? null : readDriveContextForAi();
        const outcome = await aiAdvise(router, context, triggers);
        const drafts =
          outcome.value && outcome.value.recommendations.length
            ? draftsFromAdvisorResponse(outcome.value, triggers)
            : localDrafts(facts, triggers, nextMoveOptions);
        const source = outcome.value && outcome.value.recommendations.length ? outcome.source : "engine";
        const created = assembleRecommendations({
          drafts,
          facts,
          triggers,
          blueprint: snapshot.blueprint,
          source,
          brain: source === "ai" ? outcome.brain : null,
          // Declined advice is never re-proposed for two weeks.
          existingSignatures: [
            ...live.map((r) => r.signature),
            ...suppressedSignatures(records),
          ],
          usedDriveContext: Boolean(vault && vault.length > 0),
        });
        for (const record of created) {
          await save(record);
          await log(record.id, "generated", `${record.triggerLabel} · ${record.evidenceScore.strength} evidence`);
        }
        if (!created.length) {
          setNote("Nothing new worth interrupting you about right now.");
        } else if (outcome.note) {
          setNote(outcome.note);
        }
      } finally {
        setGenerating(false);
      }
    },
    [
      ai.memories,
      facts,
      generating,
      live,
      log,
      momentum.value,
      nextMoveOptions,
      records,
      router,
      save,
      snapshot,
      triggers,
    ],
  );

  const recordFeedback = useCallback(
    async (recommendationId: string, decision: "approved" | "rejected", reason: string) => {
      if (!repository) return;
      const entry: DecisionFeedbackRecord = {
        id: newId("dfb"),
        recommendationId,
        decision,
        reason,
        createdAt: new Date().toISOString(),
      };
      await repository.put("decisionFeedback", entry);
    },
    [repository],
  );

  /**
   * Remembered trust. Grants live in settings so they survive restarts and sync
   * like any other preference. Trust only ever removes a *repeat confirmation*:
   * deterministic validation and the freshness re-check below still run.
   */
  const trustGrants = useMemo<TrustGrant[]>(
    () => snapshot?.settings.trustedActions ?? [],
    [snapshot],
  );
  const approvalCounts = useMemo(() => approvalsByActionType(records), [records]);

  const isStreamlined = useCallback(
    (record: RecommendationRecord) => {
      if (!facts) return false;
      return streamlineDecision({
        actionType: record.action.type,
        permission: permissionForAction(record.action),
        grants: trustGrants,
        stale: Boolean(checkStale(record, facts)) || record.status === "needs_reapproval",
      }).streamlined;
    },
    [facts, trustGrants],
  );

  const trustOfferFor = useCallback(
    (record: RecommendationRecord) => {
      const actionType = record.action.type;
      const permission = permissionForAction(record.action);
      const offer = shouldOfferTrust({
        actionType,
        permission,
        approvalsOfType: approvalCounts[actionType] ?? 0,
        grants: trustGrants,
      });
      return offer ? { actionType, label: trustLabel(actionType) } : null;
    },
    [approvalCounts, trustGrants],
  );

  const grantActionTrust = useCallback(
    async (actionType: string, permission: PermissionClass) => {
      const next = grantTrust(trustGrants, actionType, permission);
      if (next === trustGrants) return;
      await game.updateSettings({ trustedActions: next });
    },
    [game, trustGrants],
  );

  const revokeActionTrust = useCallback(
    async (actionType: string) => {
      await game.updateSettings({ trustedActions: revokeTrust(trustGrants, actionType) });
    },
    [game, trustGrants],
  );


  /** Approval always revalidates against fresh deterministic state. */
  const approve = useCallback(
    async (
      id: string,
      options: { force?: boolean; reason?: string; optionId?: string } = {},
    ): Promise<ApproveResult> => {
      const record = records.find((r) => r.id === id);
      if (!record || !snapshot || !facts) {
        return { ok: false, needsReapproval: false, problems: ["Recommendation not found."] };
      }

      // The player picks which option to accept; default is the preferred one.
      const chosen =
        record.options.find((o) => o.id === options.optionId) ??
        record.options[record.preferredOptionIndex] ??
        record.options[0] ??
        null;
      const chosenAction = chosen?.action ?? record.action;

      const stale = checkStale(record, facts);
      if (stale && !options.force) {
        const revalidated = validateRecommendation({
          action: chosenAction,
          facts,
          blueprint: snapshot.blueprint,
        });
        await save({
          ...record,
          status: "needs_reapproval",
          action: revalidated.action,
          validation: revalidated.report,
        });
        await log(
          record.id,
          "revalidated",
          stale === "expired" ? "Expired before approval." : "Your state changed — re-checked before applying.",
        );
        return { ok: false, needsReapproval: true, reason: stale };
      }

      const revalidated = validateRecommendation({
        action: chosenAction,
        facts,
        blueprint: snapshot.blueprint,
      });
      if (!revalidated.report.ok) {
        await save({ ...record, status: "expired", validation: revalidated.report });
        await log(record.id, "expired", "Failed revalidation, so it was not applied.");
        return {
          ok: false,
          needsReapproval: false,
          problems: revalidated.report.problems.map((p) => p.message),
        };
      }

      let questId: string | null = null;
      const action = revalidated.action;
      if (action.type === "create_quest") {
        const quest = await game.createQuest({
          name: action.quest.name,
          description: action.quest.description,
          durationMinutes: action.quest.durationMinutes,
          difficulty: action.quest.difficulty,
          isRecovery: action.quest.isRecovery,
          createdBy: record.source === "ai" ? "ai" : "engine",
          aiGenerated: record.source === "ai",
        });
        questId = quest.id;
        if (action.startImmediately) await game.startQuest(quest.id);
      } else if (action.type === "add_memory") {
        await ai.addMemory("APPROVED_DECISION", action.memory.text);
      }

      await save({
        ...record,
        status: "applied",
        action,
        validation: revalidated.report,
        questId,
        momentumAtApproval: facts.momentum,
        chosenOptionId: chosen?.id ?? null,
        decidedAt: new Date().toISOString(),
      });
      await log(
        record.id,
        "applied",
        `${chosen ? `Option "${chosen.label}" · ` : ""}${questId ? "Quest created by the deterministic engine." : "Accepted as guidance."}${
          isTrusted(trustGrants, action.type, permissionForAction(action))
            ? " Streamlined approval — still fully checked."
            : ""
        }`,
      );
      await recordFeedback(id, "approved", options.reason ?? "");
      await ai.addMemory("APPROVED_DECISION", `You approved advice: ${record.title}`);
      return { ok: true, applied: true };
    },
    [ai, facts, game, log, records, recordFeedback, save, snapshot, trustGrants],
  );

  const reject = useCallback(
    async (id: string, reason = "") => {
      const record = records.find((r) => r.id === id);
      if (!record) return;
      await save({ ...record, status: "rejected", decidedAt: new Date().toISOString() });
      await log(record.id, "rejected", reason || "Declined without a reason.");
      await recordFeedback(id, "rejected", reason);
      if (reason.trim()) await ai.addMemory("USER_PREFERENCE", `You declined "${record.title}": ${reason.trim()}`);
    },
    [ai, log, records, recordFeedback, save],
  );

  /** Measures applied recommendations whose measurement window has passed. */
  const measureDue = useCallback(async () => {
    if (!repository || !snapshot || !facts) return 0;
    const due = records.filter(
      (r) => isDueForMeasurement(r) && !outcomes.some((o) => o.recommendationId === r.id),
    );
    let measured = 0;
    for (const record of due) {
      const since = record.decidedAt ? Date.parse(record.decidedAt) : Date.now();
      const after = snapshot.questRuns.filter((run) => Date.parse(run.startedAt) >= since);
      const questRuns = record.questId ? after.filter((run) => run.questId === record.questId) : [];
      const outcome = measureOutcome({
        recommendation: record,
        facts,
        momentumAtApproval: record.momentumAtApproval ?? facts.momentum,
        completionsSince: after.filter((r) => r.outcome === "completed").length,
        missesSince: after.filter((r) => r.outcome === "missed").length,
        questCompleted: questRuns.some((r) => r.outcome === "completed"),
        questMissed: questRuns.some((r) => r.outcome === "missed"),
      });
      await repository.put("recommendationOutcomes", outcome);
      setOutcomes((prev) => [outcome, ...prev.filter((o) => o.id !== outcome.id)]);
      await log(record.id, "measured", outcome.note);
      measured += 1;
    }
    return measured;
  }, [facts, log, outcomes, records, repository, snapshot]);

  const value = useMemo<AdvisorStoreValue>(
    () => ({
      ready,
      facts,
      triggers,
      live,
      past,
      outcomes,
      history,
      memoryLines,
      generating,
      note,
      brainLabel: router?.activeBrainLabel("analysis") ?? "Local game intelligence — no AI connected",
      canGenerate,
      generate,
      approve,
      reject,
      measureDue,
      assessWithCloud,
      outcomeFor: (recommendationId) =>
        outcomes.find((o) => o.recommendationId === recommendationId) ?? null,
      historyFor: (recommendationId) =>
        history
          .filter((h) => h.recommendationId === recommendationId)
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
      trustGrants,
      isStreamlined,
      trustOfferFor,
      grantActionTrust,
      revokeActionTrust,
    }),
    [
      approve,
      grantActionTrust,
      isStreamlined,
      revokeActionTrust,
      trustGrants,
      trustOfferFor,
      assessWithCloud,
      canGenerate,
      facts,
      generate,
      generating,
      history,
      live,
      measureDue,
      memoryLines,
      note,
      outcomes,
      past,
      ready,
      reject,
      router,
      triggers,
    ],
  );

  return <AdvisorContext.Provider value={value}>{children}</AdvisorContext.Provider>;
}

export function useAdvisor(): AdvisorStoreValue {
  const value = useContext(AdvisorContext);
  if (!value) throw new Error("useAdvisor must be used inside AdvisorStoreProvider");
  return value;
}

function sortDesc(rows: RecommendationRecord[]): RecommendationRecord[] {
  return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}