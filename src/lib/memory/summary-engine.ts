import type {
  CampaignSummary,
  DailyState,
  DailySummary,
  Destination,
  QuestRun,
  WeeklySummary,
} from "../game/types";
import { dayKey } from "../game/run-engine";

/**
 * SummaryEngine — Hierarchical context compression.
 * Generates and caches Daily, Weekly, and Campaign level summaries
 * so models never have to parse unbounded raw historical logs.
 */

export function generateDailySummary(
  date: string,
  runs: QuestRun[],
  dailyState: DailyState | null,
): DailySummary {
  const dayRuns = runs.filter((r) => r.startedAt.slice(0, 10) === date);
  const completed = dayRuns.filter((r) => r.outcome === "completed");
  const missed = dayRuns.filter((r) => r.outcome === "missed");

  const totalMinutes = completed.reduce((acc, r) => acc + (r.sparksAwarded > 0 ? 15 : 0), 0);
  const completedNames = completed.map((r) => r.questName);
  const missedReasons: string[] = missed
    .map((r) => r.missReason)
    .filter((r): r is NonNullable<typeof r> => r !== null && r !== undefined)
    .map((r) => String(r));

  const energy = dailyState?.energy ?? 3;
  const blockers: string[] = missedReasons.length > 0 ? Array.from(new Set(missedReasons)) : [];

  const compressedSummary = [
    `Date: ${date}`,
    `Completed (${completedNames.length}): ${completedNames.slice(0, 3).join(", ") || "None"}`,
    missedReasons.length ? `Missed (${missedReasons.length}): ${missedReasons.join(", ")}` : null,
    `Energy: ${energy}/5`,
    dailyState?.note ? `Note: ${dailyState.note}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    id: date,
    date,
    totalMinutes,
    completedQuests: completedNames,
    remainingQuests: [],
    missedReasons,
    energyAvg: energy,
    blockers,
    compressedSummary,
    createdAt: new Date().toISOString(),
  };
}

export function generateWeeklySummary(
  year: number,
  weekNumber: number,
  dailySummaries: DailySummary[],
): WeeklySummary {
  const sessionCount = dailySummaries.reduce((sum, d) => sum + d.completedQuests.length, 0);
  const totalMinutes = dailySummaries.reduce((sum, d) => sum + d.totalMinutes, 0);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const averageSessionMinutes = sessionCount > 0 ? Math.round(totalMinutes / sessionCount) : 0;

  const successfulPatterns: string[] = [];
  if (sessionCount >= 4) successfulPatterns.push("Consistent short sessions logged");
  if (averageSessionMinutes > 0 && averageSessionMinutes <= 30) {
    successfulPatterns.push("Micro and focus blocks (15-30m) have highest follow-through");
  }

  const allBlockers = dailySummaries.flatMap((d) => d.blockers);
  const skippedPatterns = Array.from(new Set(allBlockers));

  const compressedSummary = [
    `Week ${weekNumber}, ${year}: ${sessionCount} sessions (${totalHours}h total)`,
    successfulPatterns.length ? `Strengths: ${successfulPatterns.join("; ")}` : null,
    skippedPatterns.length ? `Frequent blockers: ${skippedPatterns.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    id: `${year}-W${String(weekNumber).padStart(2, "0")}`,
    year,
    weekNumber,
    totalHours,
    sessionCount,
    averageSessionMinutes,
    successfulPatterns,
    skippedPatterns,
    risksIdentified: skippedPatterns.length >= 2 ? ["Recurring blockers detected across multiple days"] : [],
    compressedSummary,
    createdAt: new Date().toISOString(),
  };
}

export function generateCampaignSummary(
  destination: Destination,
  currentChapterTitle: string,
  weeklySummaries: WeeklySummary[],
): CampaignSummary {
  const strengths = Array.from(new Set(weeklySummaries.flatMap((w) => w.successfulPatterns)));
  const risks = Array.from(new Set(weeklySummaries.flatMap((w) => w.risksIdentified)));

  const progressState = destination.status === "completed"
    ? "complete"
    : destination.progress >= 75
    ? "substantially_complete"
    : destination.progress > 15
    ? "in_progress"
    : "early";

  const compressedSummary = [
    `Goal: ${destination.title}`,
    `Status: ${destination.status} (${progressState})`,
    `Chapter: ${currentChapterTitle}`,
    strengths.length ? `Observed strength: ${strengths[0]}` : null,
    risks.length ? `Risk: ${risks[0]}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    id: `campaign_${destination.id}`,
    destinationId: destination.id,
    deadline: destination.createdAt,
    currentChapter: currentChapterTitle,
    progressState,
    strengths,
    risks,
    compressedSummary,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Memory Promotion Rules:
 * Transitory observations -> Candidate -> Long-Term Fact.
 */
export function evaluateMemoryPromotion(
  candidateText: string,
  occurrences: number,
  isExplicitUserStatement: boolean,
): { promoteToLongTerm: boolean; kind: "FACT" | "OBSERVED_PATTERN" | "AI_HYPOTHESIS" } {
  if (isExplicitUserStatement) {
    return { promoteToLongTerm: true, kind: "FACT" };
  }
  if (occurrences >= 3) {
    return { promoteToLongTerm: true, kind: "OBSERVED_PATTERN" };
  }
  return { promoteToLongTerm: false, kind: "AI_HYPOTHESIS" };
}
