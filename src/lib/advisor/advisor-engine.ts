import type { AdvisorResponse } from "../ai/schemas";
import { newId } from "../game/quest-engine";
import type { NextMoveOption } from "../game/recommendation-engine";
import type { Difficulty, PersonalBlueprint } from "../game/types";
import { evidenceFromTrigger, resolveConfidence, scoreEvidence } from "./advisor-evidence";
import { materialSnapshotOf } from "./advisor-feedback";
import type { AdvisorFacts } from "./advisor-facts";
import type { AdvisorTrigger } from "./advisor-triggers";
import type {
  CrossImpact,
  RecommendationAction,
  RecommendationKind,
  RecommendationOption,
  RecommendationRecord,
} from "./advisor-types";
import { validateRecommendation } from "./advisor-validation";

/**
 * ADVISOR ENGINE — the deterministic assembly line.
 *
 * Drafts (from the AI or from the local engine) are turned into validated,
 * evidence-scored, deduplicated recommendations. Only records produced here are
 * ever shown, and only their validated action can later be executed.
 */

/** One proposed way to act. The first entry is the preferred one. */
export interface DraftOption {
  label: string;
  summary: string;
  action: RecommendationAction;
  tradeOff: string;
}

export interface RecommendationDraft {
  triggerCode: string;
  kind: RecommendationKind;
  title: string;
  summary: string;
  /** Preferred action — kept in sync with options[0] when options are given. */
  action: RecommendationAction;
  /** 0..3 alternatives, preferred first. Empty means "just the action above". */
  options?: DraftOption[];
  /** What the preferred option gives up. */
  tradeOff?: string;
  facts: string[];
  observations: string[];
  hypotheses: string[];
  crossImpacts: CrossImpact[];
  expectedOutcome: string;
  measureAfterHours: number;
  claimedConfidence: number | null;
}

export const MAX_LIVE_RECOMMENDATIONS = 3;
export const MAX_OPTIONS_PER_RECOMMENDATION = 3;

/** Short stable hash — used for deterministic cross-device record ids. */
export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Deterministic record id. Two devices reasoning about the same situation with
 * the same state produce the same id, so sync converges instead of duplicating.
 */
export function recommendationIdFor(signature: string, stateHash: string): string {
  return `rec_${stableHash(`${signature}::${stateHash}`)}`;
}

function actionKey(action: RecommendationAction): string {
  switch (action.type) {
    case "create_quest":
      return `create_quest|${action.quest.name.trim().toLowerCase()}|${Math.round(action.quest.durationMinutes / 5) * 5}`;
    case "create_boost":
      return `create_boost|${action.boost.name.trim().toLowerCase()}`;
    case "create_destination":
      return `create_destination|${action.destination.title.trim().toLowerCase()}`;
    case "add_memory":
      return `add_memory|${action.memory.text.trim().toLowerCase().slice(0, 40)}`;
    default:
      return "none";
  }
}

/**
 * Drive escalation rule: the vault is only worth asking for when the local
 * layers cannot carry the reasoning on their own.
 */
export function needsDriveEscalation(facts: AdvisorFacts, triggers: AdvisorTrigger[]): boolean {
  if (facts.finishedRuns < 3) return true;
  if (!triggers.length) return false;
  return triggers.every((t) => t.facts.length < 2);
}

export function signatureFor(draft: RecommendationDraft): string {
  return `${draft.triggerCode}::${draft.kind}::${actionKey(draft.action)}`;
}

/** Deterministic cross-impact analysis — what else does this touch? */
export function crossImpactsFor(draft: RecommendationDraft, facts: AdvisorFacts): CrossImpact[] {
  const impacts: CrossImpact[] = [...draft.crossImpacts];
  const push = (impact: CrossImpact) => {
    if (!impacts.some((i) => i.area === impact.area)) impacts.push(impact);
  };

  if (draft.action.type === "create_quest") {
    const quest = draft.action.quest;
    push({
      area: "Momentum",
      effect: "positive",
      note: `Completing this adds momentum from ${facts.momentum}/100.`,
    });
    push({
      area: "Run",
      effect: facts.completionsToday === 0 ? "positive" : "neutral",
      note:
        facts.completionsToday === 0
          ? `Keeps your ${facts.currentRun}-day run alive.`
          : `Your run is already safe today (${facts.completionsToday} completed).`,
    });
    if (facts.availableMinutes != null && quest.durationMinutes >= facts.availableMinutes) {
      push({
        area: "Time",
        effect: "risk",
        note: `Uses your whole ${facts.availableMinutes} minute window.`,
      });
    }
    if (facts.momentum < 20 && !quest.isRecovery) {
      push({
        area: "Recovery",
        effect: "risk",
        note: "Momentum is low — a miss here costs more than usual.",
      });
    }
  } else {
    push({ area: "Plan", effect: "neutral", note: "No game state changes; this is guidance only." });
  }
  return impacts;
}

export interface AssembleInput {
  drafts: RecommendationDraft[];
  facts: AdvisorFacts;
  triggers: AdvisorTrigger[];
  blueprint: PersonalBlueprint | null;
  source: "ai" | "engine";
  brain: string | null;
  /** Signatures already live (pending) — used for duplicate protection. */
  existingSignatures: string[];
  /** Signatures the player already declined — never proposed again. */
  suppressedSignatures?: string[];
  /** True when redacted Drive metadata was part of the reasoning context. */
  usedDriveContext?: boolean;
  /** Escape hatch for explicit user-requested reviews (Chat / "Review my system"). */
  allowInsufficientEvidence?: boolean;
  now?: number;
}

export function assembleRecommendations(input: AssembleInput): RecommendationRecord[] {
  const now = input.now ?? Date.now();
  const seen = new Set(input.existingSignatures);
  const suppressed = new Set(input.suppressedSignatures ?? []);
  const out: RecommendationRecord[] = [];

  for (const draft of input.drafts) {
    if (out.length >= MAX_LIVE_RECOMMENDATIONS) break;
    const trigger = input.triggers.find((t) => t.code === draft.triggerCode) ?? null;
    const signature = signatureFor(draft);
    if (seen.has(signature) || suppressed.has(signature)) continue;

    const draftOptions: DraftOption[] = (draft.options?.length
      ? draft.options
      : [
          {
            label: defaultOptionLabel(draft.action),
            summary: draft.summary,
            action: draft.action,
            tradeOff: draft.tradeOff ?? "",
          },
        ]
    ).slice(0, MAX_OPTIONS_PER_RECOMMENDATION);

    // Every option is validated on its own; invalid ones are never shown.
    const options: RecommendationOption[] = [];
    for (const option of draftOptions) {
      const validated = validateRecommendation({
        action: option.action,
        facts: input.facts,
        blueprint: input.blueprint,
        existingSignatures: options.length ? [] : [...seen],
        ...(options.length ? {} : { signature }),
      });
      if (!validated.report.ok) continue;
      options.push({
        id: `${signature}#${options.length}`,
        label: option.label.trim() || defaultOptionLabel(validated.action),
        summary: option.summary.trim(),
        action: validated.action,
        tradeOff: option.tradeOff.trim() || defaultTradeOff(validated.action, input.facts),
        validation: validated.report,
      });
    }
    if (!options.length) continue;

    const preferred = options[0]!;
    const report = preferred.validation;

    const evidence = evidenceFromTrigger({
      facts: dedupe([...(trigger?.facts ?? []), ...draft.facts]),
      observations: dedupe([...(trigger?.observations ?? []), ...draft.observations]),
      hypotheses: dedupe(draft.hypotheses),
    });
    const evidenceScore = scoreEvidence(evidence, input.facts.finishedRuns);
    // Silence rule: without a real evidence floor the Advisor says nothing.
    if (evidenceScore.strength === "insufficient" && !input.allowInsufficientEvidence) continue;

    const validForMinutes = trigger?.validForMinutes ?? 240;
    const withAction: RecommendationDraft = { ...draft, action: preferred.action };
    const createdAt = new Date(now).toISOString();

    seen.add(signature);
    out.push({
      id: recommendationIdFor(signature, input.facts.stateHash),
      triggerCode: draft.triggerCode,
      triggerLabel: trigger?.label ?? "Advisor review",
      kind: draft.kind,
      title: draft.title.trim(),
      summary: draft.summary.trim() || trigger?.detail || "",
      action: preferred.action,
      options,
      preferredOptionIndex: 0,
      tradeOff: preferred.tradeOff,
      evidence,
      evidenceScore,
      confidence: resolveConfidence(draft.claimedConfidence, evidenceScore),
      crossImpacts: crossImpactsFor(withAction, input.facts),
      expectedOutcome: draft.expectedOutcome.trim() || "Momentum holds or improves.",
      measureAfterHours: clampHours(draft.measureAfterHours),
      status: "pending",
      source: input.source,
      brain: input.brain,
      validation: report,
      signature,
      questId: null,
      momentumAtApproval: null,
      materialSnapshot: materialSnapshotOf(input.facts),
      chosenOptionId: null,
      usedDriveContext: input.usedDriveContext ?? false,
      createdAt,
      updatedAt: createdAt,
      decidedAt: null,
      expiresAt: new Date(now + validForMinutes * 60_000).toISOString(),
    });
  }

  return out;
}

function defaultOptionLabel(action: RecommendationAction): string {
  switch (action.type) {
    case "create_quest":
      return `${action.quest.durationMinutes} min quest`;
    case "create_boost":
      return "Add as a routine";
    case "create_destination":
      return "Add as a goal";
    case "add_memory":
      return "Save this decision";
    default:
      return "Just note it";
  }
}

function defaultTradeOff(action: RecommendationAction, facts: AdvisorFacts): string {
  switch (action.type) {
    case "create_quest":
      return facts.availableMinutes != null
        ? `Uses ${action.quest.durationMinutes} of your ${facts.availableMinutes} available minutes today.`
        : `Costs ${action.quest.durationMinutes} minutes today.`;
    case "create_boost":
      return "Commits time on repeat, so it only pays off if you keep it.";
    case "create_destination":
      return "Adds another destination competing for the same attention.";
    case "add_memory":
      return "Changes nothing today — it only shapes future advice.";
    default:
      return "Costs nothing, but nothing changes either.";
  }
}

/** Maps a validated AI response into drafts. Unknown triggers are dropped. */
export function draftsFromAdvisorResponse(
  response: AdvisorResponse,
  triggers: AdvisorTrigger[],
): RecommendationDraft[] {
  const codes = new Set(triggers.map((t) => t.code));
  return response.recommendations
    .filter((r) => r.title.trim().length > 0)
    .map((r) => {
      const triggerCode = codes.has(r.trigger_code) ? r.trigger_code : (triggers[0]?.code ?? "advisor_review");
      const questAction = (
        quest: NonNullable<AdvisorResponse["recommendations"][number]["quest"]>,
        startImmediately: boolean,
        isRecoveryKind: boolean,
      ): RecommendationAction => ({
        type: "create_quest",
        quest: {
          name: quest.name,
          description: quest.description,
          durationMinutes: quest.duration_minutes,
          difficulty: quest.difficulty as Difficulty,
          isRecovery: quest.is_recovery || isRecoveryKind,
        },
        startImmediately,
      });

      const action: RecommendationAction = r.quest
        ? questAction(r.quest, r.start_immediately, r.kind === "recovery")
        : { type: "none" };

      const aiOptions: DraftOption[] = r.options.map((option) => ({
        label: option.label,
        summary: option.summary,
        tradeOff: option.trade_off,
        action: option.quest
          ? questAction(option.quest, option.start_immediately, r.kind === "recovery")
          : option.note.trim()
            ? { type: "add_memory", memory: { text: option.note.trim() } }
            : { type: "none" },
      }));

      const options: DraftOption[] = aiOptions.length
        ? aiOptions
        : [
            {
              label: defaultOptionLabel(action),
              summary: r.summary,
              tradeOff: r.trade_off,
              action,
            },
          ];

      return {
        triggerCode,
        kind: r.kind,
        title: r.title,
        summary: r.summary,
        action: options[0]!.action,
        options,
        tradeOff: r.trade_off,
        facts: r.facts,
        observations: r.observations,
        hypotheses: r.hypotheses,
        crossImpacts: r.cross_impacts.map((i) => ({ area: i.area, effect: i.effect, note: i.note })),
        expectedOutcome: r.expected_outcome,
        measureAfterHours: r.measure_after_hours,
        claimedConfidence: r.confidence,
      };
    });
}

/** Deterministic Advisor — used whenever no brain answers usefully. */
export function localDrafts(
  facts: AdvisorFacts,
  triggers: AdvisorTrigger[],
  options: NextMoveOption[],
): RecommendationDraft[] {
  const drafts: RecommendationDraft[] = [];
  const recoveryOption = options.find((o) => o.isRecovery) ?? options[0] ?? null;

  for (const trigger of triggers.slice(0, MAX_LIVE_RECOMMENDATIONS)) {
    if (trigger.code === "momentum_low" && recoveryOption) {
      const full: RecommendationAction = {
        type: "create_quest",
        quest: {
          name: recoveryOption.title,
          description: recoveryOption.reason,
          durationMinutes: Math.min(recoveryOption.durationMinutes, 15),
          difficulty: "easy",
          isRecovery: true,
        },
        startImmediately: false,
      };
      const tiny: RecommendationAction = {
        type: "create_quest",
        quest: {
          name: `${recoveryOption.title} (5 min version)`,
          description: "The smallest version that still counts.",
          durationMinutes: 5,
          difficulty: "trivial",
          isRecovery: true,
        },
        startImmediately: false,
      };
      drafts.push({
        triggerCode: trigger.code,
        kind: "recovery",
        title: `Recovery: ${recoveryOption.title}`,
        summary: "Smallest useful action to restart momentum. No debt, no shame.",
        action: full,
        tradeOff: `Costs ${Math.min(recoveryOption.durationMinutes, 15)} minutes now, but rebuilds momentum today.`,
        options: [
          {
            label: `${Math.min(recoveryOption.durationMinutes, 15)} min recovery`,
            summary: recoveryOption.reason,
            action: full,
            tradeOff: `Costs ${Math.min(recoveryOption.durationMinutes, 15)} minutes now, but rebuilds momentum today.`,
          },
          {
            label: "5 min version",
            summary: "Lower cost, smaller momentum gain.",
            action: tiny,
            tradeOff: "Almost free to start, but the momentum gain is smaller.",
          },
          {
            label: "Skip today, keep the reason",
            summary: "Record why today is off so future advice accounts for it.",
            action: {
              type: "add_memory",
              memory: { text: "Chose to rest instead of a recovery quest while momentum was low." },
            },
            tradeOff: "Protects your energy, but momentum keeps sliding.",
          },
        ],
        facts: [],
        observations: [],
        hypotheses: ["A very small win is easier to start than a normal quest."],
        crossImpacts: [],
        expectedOutcome: "Momentum rises above the recovery floor within a day.",
        measureAfterHours: 24,
        claimedConfidence: null,
      });
      continue;
    }

    if (trigger.code === "window_open") {
      const option = options.find((o) => !o.isRecovery) ?? options[0];
      if (!option) continue;
      const fullAction: RecommendationAction = {
        type: "create_quest",
        quest: {
          name: option.title,
          description: option.reason,
          durationMinutes: option.durationMinutes,
          difficulty: option.difficulty,
          isRecovery: false,
        },
        startImmediately: false,
      };
      const halfMinutes = Math.max(5, Math.round(option.durationMinutes / 2));
      drafts.push({
        triggerCode: trigger.code,
        kind: "quest",
        title: option.title,
        summary: option.reason,
        action: fullAction,
        tradeOff: `Uses ${option.durationMinutes} minutes of today's window.`,
        options: [
          {
            label: `${option.durationMinutes} min`,
            summary: option.reason,
            action: fullAction,
            tradeOff: `Uses ${option.durationMinutes} minutes of today's window.`,
          },
          {
            label: `${halfMinutes} min short version`,
            summary: "Half the block, most of the habit value.",
            action: {
              type: "create_quest",
              quest: {
                name: `${option.title} (short)`,
                description: option.reason,
                durationMinutes: halfMinutes,
                difficulty: "easy",
                isRecovery: false,
              },
              startImmediately: false,
            },
            tradeOff: "Leaves time for other things, but progresses the goal less.",
          },
        ],
        facts: [],
        observations: [],
        hypotheses: [],
        crossImpacts: [],
        expectedOutcome: "One real action completed inside today's window.",
        measureAfterHours: 12,
        claimedConfidence: null,
      });
      continue;
    }

    drafts.push({
      triggerCode: trigger.code,
      kind: trigger.suggestedKind === "quest" ? "insight" : trigger.suggestedKind,
      title: trigger.label,
      summary: trigger.detail,
      action: { type: "none" },
      facts: [],
      observations: [],
      hypotheses: [],
      crossImpacts: [],
      expectedOutcome: "You decide whether this is worth changing.",
      measureAfterHours: 48,
      claimedConfidence: null,
    });
  }

  void facts;
  return drafts;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((i) => i.trim()).filter(Boolean))];
}

function clampHours(value: number): number {
  if (!Number.isFinite(value)) return 24;
  return Math.max(1, Math.min(168, Math.round(value)));
}