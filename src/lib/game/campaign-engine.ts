import type {
  Chapter,
  Destination,
  Milestone,
  MilestoneProof,
  ProgressState,
  Quest,
} from "./types";

/**
 * CampaignEngine — Deterministic Campaign & Progression Governance.
 *
 * Owns:
 * - Chapter hierarchy & validation
 * - Evidence-based milestone proof validation
 * - Qualitative progress state calculation (no fake percentages)
 * - Localized adaptation when deadlines or scope change
 */

export function calculateProgressState(
  milestones: Milestone[],
  proofs: MilestoneProof[] = [],
): ProgressState {
  if (milestones.length === 0) return "not_started";
  const doneCount = milestones.filter((m) => m.done).length;
  if (doneCount === 0) return "not_started";
  if (doneCount === milestones.length) return "complete";
  const ratio = doneCount / milestones.length;
  if (ratio >= 0.75) return "substantially_complete";
  if (ratio >= 0.25) return "in_progress";
  return "early";
}

export function validateChapterPrerequisites(
  chapters: Chapter[],
  targetChapterId: string,
): { allowed: boolean; reason?: string } {
  const sorted = [...chapters].sort((a, b) => a.order - b.order);
  const targetIndex = sorted.findIndex((c) => c.id === targetChapterId);
  if (targetIndex === -1) {
    return { allowed: false, reason: "Target chapter does not exist" };
  }
  if (targetIndex === 0) {
    return { allowed: true };
  }
  const previous = sorted[targetIndex - 1];
  if (previous && previous.progressState !== "complete" && previous.progressState !== "substantially_complete") {
    return {
      allowed: false,
      reason: `Prerequisite Chapter "${previous.title}" is currently ${previous.progressState}.`,
    };
  }
  return { allowed: true };
}

/**
 * Localized Adaptation:
 * When scope or deadline changes, resize or adapt ONLY the affected chapter
 * without regenerating or thrashing the rest of the campaign.
 */
export function adaptChapterScope(
  chapters: Chapter[],
  targetChapterId: string,
  newOrderOrScope: { title?: string; description?: string },
): Chapter[] {
  return chapters.map((chap) => {
    if (chap.id !== targetChapterId) return chap;
    return {
      ...chap,
      ...(newOrderOrScope.title ? { title: newOrderOrScope.title } : {}),
      ...(newOrderOrScope.description ? { description: newOrderOrScope.description } : {}),
    };
  });
}

/**
 * Validates whether an evidence proof satisfies a milestone deterministically.
 */
export function verifyMilestoneEvidence(
  milestone: Milestone,
  proof: MilestoneProof,
): boolean {
  return Boolean(proof.milestoneId === milestone.id && proof.summary.trim().length >= 5);
}
