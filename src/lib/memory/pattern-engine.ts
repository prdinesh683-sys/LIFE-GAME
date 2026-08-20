import type { ActivityEvent, QuestRun } from "../game/types";
import { MISS_REASON_LABELS } from "../game/types";
import type { MemoryConfidenceBand } from "../ai/records";
import { currentSlot } from "../game/time-window";

/**
 * Deterministic pattern discovery. Evidence and thresholds come from the
 * player's own records; an AI may explain a pattern but never invents the
 * evidence, the threshold, or the confidence band.
 */

export interface PatternThresholds {
  /** Minimum finished runs before any pattern may be declared. */
  minSamples: number;
  /** Minimum times the behaviour must recur. */
  minRecurrence: number;
  /** Window the evidence must fall inside, in days. */
  timeframeDays: number;
  /** Share of the samples that must agree (0-1). */
  minConsistency: number;
}

export const DEFAULT_THRESHOLDS: PatternThresholds = {
  minSamples: 5,
  minRecurrence: 3,
  timeframeDays: 30,
  minConsistency: 0.4,
};

export interface PatternCandidate {
  id: string;
  label: string;
  detail: string;
  /** Ids of the runs/events that support the pattern. */
  evidenceIds: string[];
  /** Ids of records that argue against it — kept, never discarded. */
  contradictionIds: string[];
  recurrence: number;
  samples: number;
  consistency: number;
  firstSeen: string;
  lastSeen: string;
  confidence: number;
  band: MemoryConfidenceBand;
  validated: boolean;
  /** True when recent evidence disagrees with older evidence. */
  evolving: boolean;
}

export function confidenceBand(confidence: number): MemoryConfidenceBand {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

/** Deterministic confidence: sample size, recurrence, consistency, recency, contradictions. */
export function patternConfidence(input: {
  samples: number;
  recurrence: number;
  consistency: number;
  contradictions: number;
  lastSeen: string;
  now?: number;
}): number {
  const now = input.now ?? Date.now();
  const sampleFactor = Math.min(1, input.samples / 10) * 0.25;
  const recurrenceFactor = Math.min(1, input.recurrence / 5) * 0.25;
  const consistencyFactor = Math.min(1, Math.max(0, input.consistency)) * 0.3;
  const ageDays = Math.max(0, (now - Date.parse(input.lastSeen)) / 86_400_000);
  const recencyFactor = Math.exp(-ageDays / 21) * 0.2;
  const penalty = Math.min(0.3, input.contradictions * 0.05);
  const raw = sampleFactor + recurrenceFactor + consistencyFactor + recencyFactor - penalty;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
}

interface Group {
  id: string;
  label: string;
  detail: (count: number, total: number) => string;
  hits: QuestRun[];
  misses: QuestRun[];
}

/** One shared slot definition — the scheduler and the learner must agree. */
function timeOfDay(run: QuestRun): string {
  return run.windowAtStart ?? currentSlot(run.startedAt);
}

/**
 * Groups finished runs into candidate behaviours, then applies the thresholds.
 * Candidates below threshold are returned as `validated: false` so the UI can
 * show "not enough evidence yet" instead of silently dropping them.
 */
export function detectPatternCandidates(
  runs: QuestRun[],
  _events: ActivityEvent[] = [],
  thresholds: PatternThresholds = DEFAULT_THRESHOLDS,
  now: number = Date.now(),
): PatternCandidate[] {
  const cutoff = now - thresholds.timeframeDays * 86_400_000;
  const finished = runs
    .filter((run) => run.outcome !== "in_progress")
    .filter((run) => Date.parse(run.startedAt) >= cutoff)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  if (finished.length < thresholds.minSamples) return [];

  const groups = new Map<string, Group>();
  const ensure = (id: string, label: string, detail: Group["detail"]): Group => {
    const existing = groups.get(id);
    if (existing) return existing;
    const created: Group = { id, label, detail, hits: [], misses: [] };
    groups.set(id, created);
    return created;
  };

  for (const run of finished) {
    const slot = timeOfDay(run);
    const timeGroup = ensure(
      `time:${slot}`,
      `${slot[0]?.toUpperCase()}${slot.slice(1)} quests tend to be completed`,
      (count, total) => `${count} of ${total} ${slot} quests were completed.`,
    );
    (run.outcome === "completed" ? timeGroup.hits : timeGroup.misses).push(run);

    if (run.outcome === "missed" && run.missReason) {
      const reasonGroup = ensure(
        `miss:${run.missReason}`,
        `Missed quests cluster around "${MISS_REASON_LABELS[run.missReason]}"`,
        (count, total) => `${count} of ${total} recent misses gave this reason.`,
      );
      reasonGroup.hits.push(run);
    }

    // Phase 6B: a recovery run is a second attempt at an earlier miss. Keeping
    // it as its own group lets later evidence tell "recovered" from "missed"
    // without a separate miss-history store.
    if (run.recoveryOfRunId) {
      const recoveryGroup = ensure(
        "recovery",
        "Second attempts after a miss usually land",
        (count, total) => `${count} of ${total} restarted quests were completed.`,
      );
      (run.outcome === "completed" ? recoveryGroup.hits : recoveryGroup.misses).push(run);
    }


    const questGroup = ensure(
      `quest:${run.questName.toLowerCase()}`,
      `"${run.questName}" is repeatedly completed`,
      (count, total) => `${count} of ${total} attempts at this quest were completed.`,
    );
    (run.outcome === "completed" ? questGroup.hits : questGroup.misses).push(run);
  }

  const candidates: PatternCandidate[] = [];
  for (const group of groups.values()) {
    const samples = group.hits.length + group.misses.length;
    const recurrence = group.hits.length;
    if (!recurrence) continue;
    const consistency = samples ? recurrence / samples : 0;
    const ordered = [...group.hits].sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
    );
    const firstSeen = ordered[0]?.startedAt ?? new Date(now).toISOString();
    const lastSeen = ordered[ordered.length - 1]?.startedAt ?? firstSeen;
    const confidence = patternConfidence({
      samples,
      recurrence,
      consistency,
      contradictions: group.misses.length,
      lastSeen,
      now,
    });
    const validated =
      samples >= thresholds.minSamples &&
      recurrence >= thresholds.minRecurrence &&
      consistency >= thresholds.minConsistency;

    candidates.push({
      id: group.id,
      label: group.label,
      detail: group.detail(recurrence, samples),
      evidenceIds: group.hits.map((run) => run.id),
      contradictionIds: group.misses.map((run) => run.id),
      recurrence,
      samples,
      consistency: Math.round(consistency * 100) / 100,
      firstSeen,
      lastSeen,
      confidence,
      band: confidenceBand(confidence),
      validated,
      evolving: isEvolving(group.hits, group.misses, now),
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Contradiction handling: when the recent half of the window disagrees with the
 * earlier half, the pattern is marked evolving instead of being rewritten.
 */
function isEvolving(hits: QuestRun[], misses: QuestRun[], now: number): boolean {
  const all = [...hits.map((r) => ({ r, ok: true })), ...misses.map((r) => ({ r, ok: false }))].sort(
    (a, b) => Date.parse(a.r.startedAt) - Date.parse(b.r.startedAt),
  );
  if (all.length < 4) return false;
  const midpoint = Math.floor(all.length / 2);
  const early = all.slice(0, midpoint);
  const recent = all.slice(midpoint);
  const rate = (rows: typeof all) => rows.filter((row) => row.ok).length / rows.length;
  void now;
  return Math.abs(rate(early) - rate(recent)) >= 0.34;
}

export function validatedPatterns(candidates: PatternCandidate[]): PatternCandidate[] {
  return candidates.filter((candidate) => candidate.validated);
}

export function describePattern(candidate: PatternCandidate): string {
  const band = `${candidate.band} confidence`;
  const evolving = candidate.evolving ? " This is changing over time — both evidence sets are kept." : "";
  return `${candidate.detail} (${candidate.recurrence}/${candidate.samples}, ${band}).${evolving}`;
}
