import type { NextMoveOption } from "../game/recommendation-engine";
import type { MissAnalysisContext } from "../game/behavior-engine";
import type { PersonalContext } from "./personal-context-service";
import type {
  BehaviorAnalysisResponse,
  ChatAnswer,
  GoalPlanResponse,
  MissAnalysisResponse,
  NextMoveResponse,
  QuestResponse,
} from "./schemas";

/**
 * LOCAL BRAIN — the deterministic answers used whenever no AI is connected or
 * the AI response is unusable. It only states things the local data proves; it
 * never invents hypotheses. This is what keeps the app fully functional with
 * zero AI configured.
 */

function facts(context: PersonalContext | null): string[] {
  const out: string[] = [];
  const c = context?.current;
  if (c) {
    out.push(`Rank ${c.identity.rank} · ${c.identity.sparks} sparks · run of ${c.identity.run}`);
    out.push(`Momentum ${c.momentum}/100`);
    if (c.state) {
      out.push(
        `Energy ${c.state.energy}/5, mood ${c.state.mood}/5, ${c.state.availableMinutes} min available`,
      );
    }
    out.push(`${c.todayCompletions} quest(s) completed today`);
    if (c.goalPriority) out.push(`Top destination: ${c.goalPriority}`);
  }
  const r = context?.recent;
  if (r?.completionRate != null) {
    out.push(`Recent completion rate ${Math.round(r.completionRate * 100)}%`);
  }
  return out;
}

export function localChatAnswer(
  context: PersonalContext | null,
  question: string,
  options: NextMoveOption[],
): ChatAnswer {
  const known = facts(context);
  const patterns = context?.recent?.patterns ?? [];
  const top = options[0];
  const lines: string[] = [];
  lines.push("No AI brain is connected, so this is your local game intelligence answering from your own data.");
  if (known.length) lines.push(`Where you stand: ${known.join(" · ")}.`);
  if (patterns.length) lines.push(`Patterns your history shows: ${patterns.join("; ")}.`);
  if (top) {
    lines.push(
      `Best next move right now: ${top.title} (${top.durationMinutes} min) — ${top.reason}`,
    );
  }
  lines.push(
    question.trim()
      ? "Connect a brain in AI Control to get a real conversation about this question."
      : "Ask about your momentum, misses, or what to do next.",
  );
  return {
    type: "chat",
    answer: lines.join("\n\n"),
    known_data: known,
    observed_patterns: patterns,
    hypotheses: [],
    recommendation: top ? `${top.title} — ${top.durationMinutes} min` : null,
    confidence: 1,
  };
}

export function localNextMove(options: NextMoveOption[]): NextMoveResponse {
  return {
    type: "next_move",
    recommendations: options.slice(0, 3).map((o) => ({
      title: o.title,
      reason: o.reason,
      duration_minutes: o.durationMinutes,
      difficulty: o.difficulty,
      attribute: o.attribute ?? null,
      rush: o.rush,
      is_recovery: o.isRecovery,
    })),
    confidence: 1,
    facts_used: ["Deterministic recommendation engine"],
    hypotheses: [],
  };
}

export function localQuest(intent: string, minutes: number): QuestResponse {
  const name = intent.trim().slice(0, 60) || "Small useful action";
  return {
    type: "quest",
    quest: {
      name,
      description: "Created locally from your own words — no AI involved.",
      duration_minutes: Math.max(5, Math.min(120, minutes)),
      difficulty: minutes >= 45 ? "hard" : minutes >= 25 ? "normal" : "easy",
      attribute: null,
      goal: "",
    },
    confidence: 1,
    facts_used: ["Your typed intent"],
    hypotheses: [],
  };
}

export function localMissAnalysis(
  miss: MissAnalysisContext,
  context: PersonalContext | null,
): MissAnalysisResponse {
  const reasonLabel = miss.reason ? miss.reason.replace(/_/g, " ") : "no reason recorded";
  const smaller = Math.max(5, Math.round(miss.durationMinutes / 3));
  return {
    type: "missed_quest_analysis",
    likely_reason: `Recorded as: ${reasonLabel}.`,
    supporting_facts: facts(context),
    recommended_recovery: {
      title: `${miss.questName} — smallest version`,
      duration_minutes: smaller,
    },
    proposed_adjustment:
      miss.durationMinutes > 20
        ? `Shrink this quest to about ${smaller} minutes until it lands three times in a row.`
        : "Keep the size and try a different time of day.",
    confidence: 1,
    facts_used: ["Your recorded miss reason"],
    hypotheses: [],
  };
}

export function localBehaviorAnalysis(context: PersonalContext | null): BehaviorAnalysisResponse {
  const r = context?.recent;
  return {
    type: "behavior_analysis",
    confirmed_facts: facts(context),
    observed_patterns: r?.patterns ?? [],
    hypotheses: [],
    possible_drains: (context?.longTerm?.drains ?? []).map((d) => `${d.name} (trigger: ${d.trigger})`),
    successful_boosts: (context?.longTerm?.boosts ?? []).map((b) => b.name),
    recommended_experiments:
      r?.misses.length
        ? ["Halve the size of your most-missed quest for the next three days."]
        : ["Add one boost right after your strongest daily anchor."],
    suggested_changes: [],
    confidence: 1,
    facts_used: ["Local pattern detection"],
  };
}

export function localGoalPlan(rawGoal: string): GoalPlanResponse {
  const title = rawGoal.trim().slice(0, 70) || "New destination";
  return {
    type: "goal_plan",
    destination: {
      title,
      description: "Drafted locally from your own words — connect a brain for a deeper plan.",
      priority: 2,
      duration_weeks: 4,
      attributes: [],
      difficulty: "normal",
      is_boss: false,
    },
    milestones: ["Week 1 — start small and daily", "Week 2 — hold the streak", "Week 4 — raise the size"],
    quests: [
      { name: `${title}: 15-minute start`, duration_minutes: 15, difficulty: "easy", attribute: null },
      { name: `${title}: focused block`, duration_minutes: 30, difficulty: "normal", attribute: null },
    ],
    schedule: "Daily, at the same time as an existing habit.",
    risks: ["Starting too big", "No fixed time slot"],
    boosts: [],
    possible_drains: [],
    trophies: [`${title} — 7 days in a row`],
    confidence: 1,
    facts_used: ["Your typed goal"],
    hypotheses: [],
  };
}
