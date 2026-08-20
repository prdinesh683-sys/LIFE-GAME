import type { AdvisorFacts } from "./advisor-facts";
import type { RecommendationRecord } from "./advisor-types";

/**
 * PHASE 4A — material-change detection.
 *
 * The Advisor may come back before a recommendation expires, but only when the
 * situation it was written for has actually moved. Detection is hybrid:
 * deterministic candidates are computed here from the player's own records, and
 * an AI layer may only *reject* a candidate as irrelevant — it can never invent
 * a change on its own.
 */

export interface MaterialSnapshot {
  momentum: number;
  energy: number | null;
  mood: number | null;
  availableMinutes: number | null;
  hasActiveRun: boolean;
  completionsToday: number;
  misses7d: number;
  currentRun: number;
  activeDestinations: number;
  runAtRisk: boolean;
}

export interface MaterialChange {
  code: string;
  label: string;
  detail: string;
  /** 0..1 — how strongly this alone justifies revisiting. */
  magnitude: number;
}

export function materialSnapshotOf(facts: AdvisorFacts): MaterialSnapshot {
  return {
    momentum: facts.momentum,
    energy: facts.energy,
    mood: facts.mood,
    availableMinutes: facts.availableMinutes,
    hasActiveRun: facts.hasActiveRun,
    completionsToday: facts.completionsToday,
    misses7d: facts.misses7d,
    currentRun: facts.currentRun,
    activeDestinations: facts.activeDestinations.length,
    runAtRisk: facts.runAtRisk,
  };
}

/** Deterministic change candidates between the state then and the state now. */
export function detectMaterialChanges(
  before: MaterialSnapshot,
  facts: AdvisorFacts,
): MaterialChange[] {
  const after = materialSnapshotOf(facts);
  const changes: MaterialChange[] = [];

  const momentumDelta = Math.abs(after.momentum - before.momentum);
  if (momentumDelta >= 15) {
    changes.push({
      code: "momentum_moved",
      label: "Momentum moved",
      detail: `Momentum went from ${before.momentum} to ${after.momentum}.`,
      magnitude: Math.min(1, momentumDelta / 40),
    });
  }

  if (before.energy != null && after.energy != null && Math.abs(after.energy - before.energy) >= 2) {
    changes.push({
      code: "energy_changed",
      label: "Energy changed",
      detail: `Energy went from ${before.energy}/5 to ${after.energy}/5.`,
      magnitude: 0.7,
    });
  }

  const beforeMinutes = before.availableMinutes ?? 0;
  const afterMinutes = after.availableMinutes ?? 0;
  if (Math.abs(afterMinutes - beforeMinutes) >= 20) {
    changes.push({
      code: "window_changed",
      label: "Available time changed",
      detail: `Available minutes went from ${beforeMinutes} to ${afterMinutes}.`,
      magnitude: 0.8,
    });
  }

  if (after.hasActiveRun !== before.hasActiveRun) {
    changes.push({
      code: "run_state_changed",
      label: after.hasActiveRun ? "A quest is now running" : "The active quest ended",
      detail: "What can be started right now is different.",
      magnitude: 0.6,
    });
  }

  if (after.completionsToday > before.completionsToday) {
    changes.push({
      code: "completed_since",
      label: "You completed something since",
      detail: `${after.completionsToday - before.completionsToday} completion(s) recorded after this advice.`,
      magnitude: 0.9,
    });
  }

  if (after.misses7d > before.misses7d) {
    changes.push({
      code: "missed_since",
      label: "A quest was missed since",
      detail: "The blocker picture changed.",
      magnitude: 0.8,
    });
  }

  if (after.runAtRisk && !before.runAtRisk) {
    changes.push({
      code: "deadline_now",
      label: "The day is closing",
      detail: "Your run is now at risk today.",
      magnitude: 1,
    });
  }

  if (after.activeDestinations !== before.activeDestinations) {
    changes.push({
      code: "goals_changed",
      label: "Your goals changed",
      detail: `Active destinations went from ${before.activeDestinations} to ${after.activeDestinations}.`,
      magnitude: 0.7,
    });
  }

  return changes;
}

export const MATERIAL_CHANGE_THRESHOLD = 0.8;

/** Deterministic verdict — the AI layer may only veto this, never create it. */
export function isMaterialChange(changes: MaterialChange[]): boolean {
  if (!changes.length) return false;
  return changes.some((c) => c.magnitude >= MATERIAL_CHANGE_THRESHOLD) || changes.length >= 3;
}

export function describeChanges(changes: MaterialChange[]): string {
  return changes.map((c) => c.detail).join(" ");
}

/** Signatures of recently declined advice — never proposed again. */
export function suppressedSignatures(
  records: RecommendationRecord[],
  windowDays = 14,
  now: number = Date.now(),
): string[] {
  const cutoff = now - windowDays * 86_400_000;
  return [
    ...new Set(
      records
        .filter(
          (r) =>
            r.status === "rejected" &&
            Date.parse(r.decidedAt ?? r.createdAt) >= cutoff,
        )
        .map((r) => r.signature),
    ),
  ];
}
