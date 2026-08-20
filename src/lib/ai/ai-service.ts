import type { AdvisorTrigger } from "../advisor/advisor-triggers";
import type { MissAnalysisContext } from "../game/behavior-engine";
import type { NextMoveOption } from "../game/recommendation-engine";
import {
  localBehaviorAnalysis,
  localChatAnswer,
  localGoalPlan,
  localMissAnalysis,
  localNextMove,
  localQuest,
} from "./local-brain";
import type { PersonalContext } from "./personal-context-service";
import type { AiOutcome, AIRouter } from "./router";
import type {
  AdvisorResponse,
  ChangeRelevanceResponse,
  BehaviorAnalysisResponse,
  ChatAnswer,
  GoalPlanResponse,
  MissAnalysisResponse,
  NextMoveResponse,
  QuestResponse,
} from "./schemas";
import type { ChatMessage } from "./types";

/**
 * AI job surface used by the UI.
 *
 * Every function follows the non-negotiable rule: the AI proposes, the
 * deterministic engine (or local brain) is the fallback and the authority, and
 * nothing here writes game state.
 */

export function askChat(
  router: AIRouter | null,
  context: PersonalContext | null,
  history: ChatMessage[],
  question: string,
  options: NextMoveOption[],
): Promise<AiOutcome<ChatAnswer>> {
  const fallback = () => localChatAnswer(context, question, options);
  if (!router || !context) return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  return router.run("chat", (p) => p.chat([...history, { role: "user", content: question }], context), fallback);
}

export function aiNextMove(
  router: AIRouter | null,
  context: PersonalContext | null,
  options: NextMoveOption[],
): Promise<AiOutcome<NextMoveResponse>> {
  const fallback = () => localNextMove(options);
  if (!router || !context) return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  return router.run("chat", (p) => p.generateNextMove(context), fallback);
}

export function aiQuest(
  router: AIRouter | null,
  context: PersonalContext | null,
  intent: string,
  minutes: number,
): Promise<AiOutcome<QuestResponse>> {
  const fallback = () => localQuest(intent, minutes);
  if (!router || !context) return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  return router.run("quest", (p) => p.generateQuest(intent, context), fallback);
}

export function aiMissAnalysis(
  router: AIRouter | null,
  context: PersonalContext | null,
  miss: MissAnalysisContext,
): Promise<AiOutcome<MissAnalysisResponse>> {
  const fallback = () => localMissAnalysis(miss, context);
  if (!router || !context) return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  return router.run("analysis", (p) => p.analyzeMissedQuest(miss, context), fallback);
}

export function aiBehaviorAnalysis(
  router: AIRouter | null,
  context: PersonalContext | null,
): Promise<AiOutcome<BehaviorAnalysisResponse>> {
  const fallback = () => localBehaviorAnalysis(context);
  if (!router || !context) return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  return router.run("analysis", (p) => p.analyzeBehavior(context), fallback);
}

export function aiGoalPlan(
  router: AIRouter | null,
  context: PersonalContext | null,
  rawGoal: string,
): Promise<AiOutcome<GoalPlanResponse>> {
  const fallback = () => localGoalPlan(rawGoal);
  if (!router || !context) return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  return router.run("planning", (p) => p.generateGoalPlan(rawGoal, context), fallback);
}

/**
 * PHASE 4A — Advisor interpretation. Situations are already proven by the
 * deterministic trigger engine; a null value means "no brain answered", and the
 * caller then assembles the local Advisor drafts instead.
 */
export function aiAdvise(
  router: AIRouter | null,
  context: PersonalContext | null,
  triggers: AdvisorTrigger[],
): Promise<AiOutcome<AdvisorResponse | null>> {
  const fallback = (): AdvisorResponse | null => null;
  if (!router || !context || !triggers.length) {
    return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  }
  const situations = triggers.map((t) => ({
    code: t.code,
    label: t.label,
    detail: t.detail,
    facts: t.facts,
    observations: t.observations,
  }));
  return router.run("analysis", (p) => p.advise(situations, context), fallback);
}

/**
 * PHASE 4A — hybrid material-change check. The deterministic layer already
 * proved the change; this only asks a connected brain whether the existing
 * advice survives it. With no brain, the deterministic verdict stands.
 */
export function aiAssessChange(
  router: AIRouter | null,
  context: PersonalContext | null,
  advice: { title: string; summary: string; expectedOutcome: string },
  changes: { label: string; detail: string }[],
): Promise<AiOutcome<ChangeRelevanceResponse | null>> {
  const fallback = (): ChangeRelevanceResponse | null => null;
  if (!router || !context || !changes.length) {
    return Promise.resolve({ value: fallback(), source: "engine", brain: null });
  }
  return router.run("analysis", (p) => p.assessChange(advice, changes, context), fallback);
}
