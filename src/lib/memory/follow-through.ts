import type { PatternCandidate } from "./pattern-engine";
import type { TimeWindow } from "../game/time-window";
import { TIME_WINDOWS, TIME_WINDOW_LABELS, slotIndex } from "../game/time-window";

/**
 * PHASE 6B — "When do I actually follow through?"
 *
 * A projection over `detectPatternCandidates`. There is no second scoring
 * algorithm here: the counts, the evidence and the thresholds all come from
 * the existing pattern engine. This module only reshapes the time-of-day
 * candidates into one line a person can read in a couple of seconds.
 */

/** A slot is never named until this many finished runs happened in it. */
export const FOLLOW_THROUGH_MIN_RUNS = 3;

export interface FollowThroughSlot {
  slot: TimeWindow;
  completed: number;
  total: number;
  /** Whole-number percent, deterministic. */
  percent: number;
  /** "Morning — 4 of 5 completed" */
  label: string;
  evidenceIds: string[];
}

export interface FollowThroughSummary {
  slots: FollowThroughSlot[];
  best: FollowThroughSlot | null;
  hasEvidence: boolean;
  /** One short line, safe to show on its own. */
  headline: string;
}

export const NOT_ENOUGH_EVIDENCE = "Not enough evidence yet — a few more finished quests and I'll know.";

export function followThroughByWindow(candidates: PatternCandidate[]): FollowThroughSummary {
  const slots: FollowThroughSlot[] = [];

  for (const slot of TIME_WINDOWS) {
    const candidate = candidates.find((c) => c.id === `time:${slot}`);
    if (!candidate) continue;
    const total = candidate.samples;
    if (total < FOLLOW_THROUGH_MIN_RUNS) continue;
    const completed = candidate.recurrence;
    slots.push({
      slot,
      completed,
      total,
      percent: Math.round((completed / total) * 100),
      label: `${TIME_WINDOW_LABELS[slot]} — ${completed} of ${total} completed`,
      evidenceIds: candidate.evidenceIds,
    });
  }

  slots.sort((a, b) => b.percent - a.percent || b.total - a.total || slotIndex(a.slot) - slotIndex(b.slot));
  const best = slots[0] ?? null;

  return {
    slots,
    best,
    hasEvidence: slots.length > 0,
    headline: best
      ? `You follow through most in the ${TIME_WINDOW_LABELS[best.slot].toLowerCase()} — ${best.completed} of ${best.total} completed.`
      : NOT_ENOUGH_EVIDENCE,
  };
}
