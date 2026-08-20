import type { AdvisorFacts } from "./advisor-facts";
import type { RecommendationKind } from "./advisor-types";

/**
 * Deterministic trigger detection. The Advisor never "decides on its own" when
 * to speak: a situation must be provable from local records first. Each trigger
 * is auditable — it carries the facts and observations that opened it.
 */

export interface AdvisorTrigger {
  code: string;
  label: string;
  detail: string;
  /** 1 (low) .. 5 (urgent) — deterministic ordering input. */
  severity: number;
  suggestedKind: RecommendationKind;
  facts: string[];
  observations: string[];
  /** How long a recommendation from this trigger stays relevant. */
  validForMinutes: number;
}

const H = (n: number | null, digits = 0) => (n == null ? "unknown" : n.toFixed(digits));

export function detectTriggers(facts: AdvisorFacts): AdvisorTrigger[] {
  const triggers: AdvisorTrigger[] = [];

  if (facts.momentum < 20 && facts.finishedRuns >= 1) {
    triggers.push({
      code: "momentum_low",
      label: "Momentum has dropped",
      detail: "A small, easy action rebuilds momentum faster than a big one.",
      severity: facts.momentum < 10 ? 5 : 4,
      suggestedKind: "recovery",
      facts: [
        `Momentum is ${facts.momentum}/100`,
        facts.hoursSinceLastAction != null
          ? `Last finished action was ${H(facts.hoursSinceLastAction)}h ago`
          : "No finished action recorded yet",
      ],
      observations: facts.patterns.slice(0, 2),
      validForMinutes: 240,
    });
  }

  if (facts.misses7d >= 2 && facts.topMissReason) {
    triggers.push({
      code: "repeated_misses",
      label: `Repeated blocker: ${facts.topMissReason.label}`,
      detail: "The same blocker keeps showing up — design around it instead of pushing harder.",
      severity: facts.misses7d >= 4 ? 4 : 3,
      suggestedKind: "routine_change",
      facts: [
        `${facts.misses7d} missed quest(s) in the last 7 days`,
        `Most common recorded reason: ${facts.topMissReason.label} (${facts.topMissReason.count}x)`,
      ],
      observations:
        facts.completionRate7d != null
          ? [`7-day completion rate is ${Math.round(facts.completionRate7d * 100)}%`]
          : [],
      validForMinutes: 1440,
    });
  }

  const staleDestination = facts.activeDestinations.find(
    (d) => d.staleDays == null || d.staleDays >= 7,
  );
  if (staleDestination) {
    triggers.push({
      code: "goal_stalled",
      label: `"${staleDestination.title}" has stalled`,
      detail: "An active destination with no recent quests either needs a smaller step or a lower priority.",
      severity: 3,
      suggestedKind: "goal_adjustment",
      facts: [
        `Destination "${staleDestination.title}" is at ${Math.round(staleDestination.progress)}% progress`,
        staleDestination.staleDays == null
          ? "No quest for this destination has ever been run"
          : `No quest for this destination in ${staleDestination.staleDays} day(s)`,
      ],
      observations: [],
      validForMinutes: 2880,
    });
  }

  if (facts.energy != null && facts.availableMinutes != null && !facts.hasActiveRun) {
    triggers.push({
      code: "window_open",
      label: "You have a usable window right now",
      detail: "Current state fits one real action.",
      severity: facts.completionsToday === 0 ? 3 : 2,
      suggestedKind: "quest",
      facts: [
        `Energy ${facts.energy}/5, mood ${H(facts.mood)}/5`,
        `${facts.availableMinutes} minutes available`,
        `${facts.completionsToday} quest(s) completed today`,
      ],
      observations: facts.bestHour != null ? [`Most completions happen around ${facts.bestHour}:00`] : [],
      validForMinutes: 180,
    });
  }

  if (facts.runAtRisk) {
    triggers.push({
      code: "deadline_proximity",
      label: "Your run ends in a few hours",
      detail: "The day closes soon and nothing is completed yet — one small action protects the run.",
      severity: 5,
      suggestedKind: "quest",
      facts: [
        `${H(facts.hoursLeftToday, 1)}h left in today`,
        `Current run is ${facts.currentRun} day(s) and today has 0 completions`,
      ],
      observations: facts.bestHour != null ? [`Most completions happen around ${facts.bestHour}:00`] : [],
      validForMinutes: 120,
    });
  }

  if (
    facts.rateDeltaVs30d != null &&
    facts.rateDeltaVs30d <= -0.25 &&
    facts.finishedRuns >= 6
  ) {
    triggers.push({
      code: "unusual_pattern",
      label: "This week breaks your usual pattern",
      detail: "Your recent completion rate is clearly below your own baseline — something changed, not you.",
      severity: 4,
      suggestedKind: "experiment",
      facts: [
        `7-day completion rate ${Math.round((facts.completionRate7d ?? 0) * 100)}% vs 30-day ${Math.round((facts.completionRate30d ?? 0) * 100)}%`,
        `${facts.misses7d} miss(es) in the last 7 days`,
      ],
      observations: facts.patterns.slice(0, 2),
      validForMinutes: 1440,
    });
  }

  if (facts.competingDestinations.length >= 2) {
    const [a, b] = facts.competingDestinations;
    triggers.push({
      code: "cross_goal_conflict",
      label: `"${a!.title}" and "${b!.title}" are competing`,
      detail: "Two top-priority destinations are both waiting — sequencing them beats splitting attention.",
      severity: 3,
      suggestedKind: "goal_adjustment",
      facts: [
        `"${a!.title}" (priority ${a!.priority}) untouched for ${a!.staleDays ?? "ever"} day(s)`,
        `"${b!.title}" (priority ${b!.priority}) untouched for ${b!.staleDays ?? "ever"} day(s)`,
      ],
      observations:
        facts.availableMinutes != null
          ? [`Only ${facts.availableMinutes} minutes are available today`]
          : [],
      validForMinutes: 2880,
    });
  }

  if (facts.unusedBoosts.length && facts.finishedRuns >= 3) {
    triggers.push({
      code: "boost_unused",
      label: `Unused boost: ${facts.unusedBoosts[0]!.name}`,
      detail: "A boost you defined has not been used in the last two weeks.",
      severity: 2,
      suggestedKind: "experiment",
      facts: [
        `"${facts.unusedBoosts[0]!.name}" has no run in the last 14 days`,
        `${facts.unusedBoosts.length} boost(s) currently unused`,
      ],
      observations: [],
      validForMinutes: 2880,
    });
  }

  if (facts.loggedDrains7d >= 3) {
    triggers.push({
      code: "drains_rising",
      label: "Drains logged more often",
      detail: "Recorded drains are frequent — a planned counter-move works better than willpower.",
      severity: 3,
      suggestedKind: "routine_change",
      facts: [`${facts.loggedDrains7d} drain(s) logged in the last 7 days`],
      observations: facts.patterns.slice(0, 1),
      validForMinutes: 1440,
    });
  }

  if (facts.currentRun >= 3 && facts.completionRate7d != null && facts.completionRate7d >= 0.7) {
    triggers.push({
      code: "streak_strong",
      label: "You are on a strong run",
      detail: "Good moment for a slightly harder step — still bounded by today's state.",
      severity: 2,
      suggestedKind: "quest",
      facts: [
        `Current run is ${facts.currentRun} day(s), best is ${facts.bestRun}`,
        `7-day completion rate is ${Math.round(facts.completionRate7d * 100)}%`,
      ],
      observations: [],
      validForMinutes: 720,
    });
  }

  if (facts.finishedRuns < 3) {
    triggers.push({
      code: "cold_start",
      label: "Not enough history yet",
      detail: "Advice stays deliberately small until there is data to learn from.",
      severity: 1,
      suggestedKind: "insight",
      facts: [`${facts.finishedRuns} finished quest run(s) recorded`],
      observations: [],
      validForMinutes: 1440,
    });
  }

  return triggers.sort((a, b) => b.severity - a.severity);
}