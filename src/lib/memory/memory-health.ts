import { normalizeMemory, type MemoryRecord } from "../ai/records";
import { findDuplicates, findNearDuplicates } from "./memory-dedupe";

/**
 * Memory health — deterministic, inspectable indicators. No AI involvement.
 */

export interface MemoryHealth {
  active: number;
  archived: number;
  superseded: number;
  patterns: number;
  hypotheses: number;
  decisions: number;
  duplicateGroups: number;
  duplicateDensity: number;
  nearDuplicates: number;
  staleCount: number;
  unsupportedHypotheses: number;
  lowValue: number;
  heavilyReused: number;
  unresolvedConflicts: number;
  score: number;
  band: "good" | "fair" | "needs attention";
  notes: string[];
}

export interface HealthInput {
  memories: MemoryRecord[];
  unresolvedConflicts?: number;
  /** Memories untouched for this many days count as stale. */
  staleAfterDays?: number;
  now?: number;
}

export function memoryHealth(input: HealthInput): MemoryHealth {
  const now = input.now ?? Date.now();
  const staleAfter = (input.staleAfterDays ?? 120) * 86_400_000;
  const all = input.memories.map(normalizeMemory);
  const active = all.filter((m) => m.status === "active");

  const duplicateGroups = findDuplicates(all);
  const duplicateRows = duplicateGroups.reduce((sum, group) => sum + group.duplicates.length, 0);
  const nearDuplicates = findNearDuplicates(all).length;

  const staleCount = active.filter(
    (m) => now - Date.parse(m.updatedAt) > staleAfter && m.useCount === 0 && !m.pinned,
  ).length;
  const unsupportedHypotheses = active.filter(
    (m) => m.kind === "AI_HYPOTHESIS" && m.supportingEvidenceIds.length === 0,
  ).length;
  const lowValue = active.filter((m) => (m.importanceScore ?? 0) < 25 && !m.pinned).length;
  const heavilyReused = active.filter((m) => m.useCount >= 5).length;
  const unresolvedConflicts = input.unresolvedConflicts ?? 0;

  const duplicateDensity = active.length ? Math.round((duplicateRows / active.length) * 100) / 100 : 0;

  let score = 100;
  score -= Math.min(30, duplicateRows * 5);
  score -= Math.min(20, staleCount * 2);
  score -= Math.min(20, unsupportedHypotheses * 3);
  score -= Math.min(15, lowValue);
  score -= Math.min(25, unresolvedConflicts * 10);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const notes: string[] = [];
  if (duplicateRows) notes.push(`${duplicateRows} duplicate memories can be consolidated.`);
  if (staleCount) notes.push(`${staleCount} memories have not been used in a long time.`);
  if (unsupportedHypotheses) notes.push(`${unsupportedHypotheses} AI hypotheses have no supporting evidence yet.`);
  if (unresolvedConflicts) notes.push(`${unresolvedConflicts} memory conflicts need your decision.`);
  if (!notes.length) notes.push("Memory looks healthy — nothing needs your attention.");

  return {
    active: active.length,
    archived: all.filter((m) => m.status === "archived").length,
    superseded: all.filter((m) => m.status === "superseded").length,
    patterns: active.filter((m) => m.kind === "OBSERVED_PATTERN").length,
    hypotheses: active.filter((m) => m.kind === "AI_HYPOTHESIS").length,
    decisions: active.filter((m) => m.kind === "APPROVED_DECISION").length,
    duplicateGroups: duplicateGroups.length,
    duplicateDensity,
    nearDuplicates,
    staleCount,
    unsupportedHypotheses,
    lowValue,
    heavilyReused,
    unresolvedConflicts,
    score,
    band: score >= 80 ? "good" : score >= 55 ? "fair" : "needs attention",
    notes,
  };
}
