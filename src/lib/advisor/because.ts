import type { PatternCandidate } from "../memory/pattern-engine";
import type { TimeWindow } from "../game/time-window";
import { TIME_WINDOW_LABELS } from "../game/time-window";
import type { OutcomeResult } from "./advisor-types";

/**
 * PHASE 6B — the deterministic "because…" line.
 *
 * This is NOT an explanation engine. It is a selector: it picks exactly one
 * already-recorded evidence source, in a fixed priority order, and turns it
 * into one plain sentence. The same inputs always produce the same sentence.
 *
 * An AI may rephrase the finished sentence. It may never choose the evidence,
 * invent a reason, or claim a pattern the thresholds did not validate — a
 * rephrase that loses the evidence reference is rejected.
 */

export type BecauseTier = "pattern" | "outcome" | "stated" | "fact" | "insufficient";

export interface BecauseReason {
  tier: BecauseTier;
  /** One short line, ready to display. */
  sentence: string;
  /** The fragment of recorded evidence the sentence must keep. */
  evidenceRef: string;
  /** Records this came from. Internal only — never rendered. */
  evidenceIds: string[];
  /** False only for the thin-evidence state. */
  sufficient: boolean;
}

/** The only honest thing to say when nothing has been recorded yet. */
export const THIN_EVIDENCE_SENTENCE =
  "I don't have enough history for this yet — this is a starting guess.";

export const THIN_EVIDENCE_REASON: BecauseReason = {
  tier: "insufficient",
  sentence: THIN_EVIDENCE_SENTENCE,
  evidenceRef: "",
  evidenceIds: [],
  sufficient: false,
};

/** A measured outcome of an earlier recommendation of the same shape. */
export interface OutcomeEvidence {
  recommendationId: string;
  /** Action type of the recommendation — the "shape" being compared. */
  shape: string;
  result: OutcomeResult;
  measuredAt: string;
}

export interface StatedEvidence {
  priorities: string[];
  goals: string[];
  constraints: string[];
}

export interface BecauseInput {
  /** Output of detectPatternCandidates — nothing is re-scored here. */
  patterns: PatternCandidate[];
  outcomes: OutcomeEvidence[];
  /** Action shape of the thing being explained (e.g. "create_quest"). */
  shape?: string | null;
  questName?: string | null;
  /** Part of the day the recommendation applies to. */
  slot?: TimeWindow | null;
  stated?: StatedEvidence | null;
  /** Immediate recorded facts, strongest first (deterministic order in). */
  facts?: string[];
}

/** Picks exactly one evidence source and returns one sentence. */
export function selectBecause(input: BecauseInput): BecauseReason {
  return (
    fromPattern(input) ??
    fromOutcome(input) ??
    fromStated(input) ??
    fromFact(input) ??
    THIN_EVIDENCE_REASON
  );
}

/* ---------- tier 1: a validated pattern ---------- */

function fromPattern(input: BecauseInput): BecauseReason | null {
  const validated = input.patterns.filter((p) => p.validated);
  if (!validated.length) return null;

  const questId = input.questName ? `quest:${input.questName.toLowerCase()}` : null;
  const slotId = input.slot ? `time:${input.slot}` : null;

  const match =
    (questId ? pick(validated, questId) : null) ?? (slotId ? pick(validated, slotId) : null);
  if (!match) return null;

  const ref = `${match.recurrence} of ${match.samples}`;
  const sentence = match.id.startsWith("quest:")
    ? `Because you've finished this one ${ref} times you've tried it.`
    : `Because your ${TIME_WINDOW_LABELS[input.slot as TimeWindow].toLowerCase()} attempts usually get done — ${ref} recently.`;

  return {
    tier: "pattern",
    sentence,
    evidenceRef: ref,
    evidenceIds: match.evidenceIds,
    sufficient: true,
  };
}

/** Deterministic tie-break: highest confidence, then id order. */
function pick(candidates: PatternCandidate[], id: string): PatternCandidate | null {
  const matches = candidates
    .filter((c) => c.id === id)
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  return matches[0] ?? null;
}

/* ---------- tier 2: a measured outcome of the same shape ---------- */

function fromOutcome(input: BecauseInput): BecauseReason | null {
  if (!input.shape) return null;
  const same = input.outcomes
    .filter((o) => o.shape === input.shape && o.result !== "unmeasured")
    .sort(
      (a, b) =>
        Date.parse(b.measuredAt) - Date.parse(a.measuredAt) ||
        a.recommendationId.localeCompare(b.recommendationId),
    );
  const latest = same[0];
  if (!latest) return null;

  const ref = "last time you tried this";
  const tail =
    latest.result === "followed_worked"
      ? "it moved things forward."
      : latest.result === "followed_no_change"
        ? "nothing measurably changed."
        : "it never actually happened.";

  return {
    tier: "outcome",
    sentence: `Because the ${ref}, ${tail}`,
    evidenceRef: ref,
    evidenceIds: [latest.recommendationId],
    sufficient: true,
  };
}

/* ---------- tier 3: something the player stated in Game setup ---------- */

function fromStated(input: BecauseInput): BecauseReason | null {
  const stated = input.stated;
  if (!stated) return null;

  const priority = firstText(stated.priorities);
  if (priority) {
    return statedReason(`Because you said "${priority}" is a priority right now.`, priority);
  }
  const goal = firstText(stated.goals);
  if (goal) {
    return statedReason(`Because you said you want to ${lower(goal)}.`, goal);
  }
  const constraint = firstText(stated.constraints);
  if (constraint) {
    return statedReason(`Because you told me ${lower(constraint)}.`, constraint);
  }
  return null;
}

function statedReason(sentence: string, ref: string): BecauseReason {
  return { tier: "stated", sentence, evidenceRef: ref, evidenceIds: [], sufficient: true };
}

/* ---------- tier 4: an immediate recorded fact ---------- */

function fromFact(input: BecauseInput): BecauseReason | null {
  const fact = firstText(input.facts ?? []);
  if (!fact) return null;
  const clean = fact.replace(/\.$/, "");
  return {
    tier: "fact",
    sentence: `Because ${lower(clean)}.`,
    evidenceRef: clean,
    evidenceIds: [],
    sufficient: true,
  };
}

/* ---------- AI rephrasing: explanatory only ---------- */

export const MAX_REASON_LENGTH = 180;

/**
 * Accepts an AI rephrase only when it still points at the same recorded
 * evidence. Anything else falls back to the deterministic sentence, so
 * offline and AI-off behave identically to a rejected rephrase.
 */
export function applyRephrase(reason: BecauseReason, rephrased: string | null | undefined): string {
  if (!reason.sufficient) return reason.sentence;
  const text = (rephrased ?? "").trim();
  if (!text) return reason.sentence;
  if (text.length > MAX_REASON_LENGTH) return reason.sentence;
  if (!/^because\b/i.test(text)) return reason.sentence;
  if (!normalize(text).includes(normalize(reason.evidenceRef))) return reason.sentence;
  return text;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstText(values: string[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function lower(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
