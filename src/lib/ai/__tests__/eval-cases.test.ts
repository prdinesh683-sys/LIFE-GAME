import { describe, expect, it } from "vitest";
import {
  dailyInterpretationSchema,
  goalClarificationSchema,
  reflectionAdaptationSchema,
  situationUnderstandingSchema,
} from "../schemas";
import {
  evaluateInterviewReadiness,
} from "../interview-engine";
import {
  calculateProgressState,
  validateChapterPrerequisites,
  adaptChapterScope,
} from "../../game/campaign-engine";
import {
  validateChangeProposal,
  createAuditEntry,
} from "../../game/proposal-engine";
import {
  generateDailySummary,
  generateWeeklySummary,
  generateCampaignSummary,
  evaluateMemoryPromotion,
} from "../../memory/summary-engine";
import {
  buildPersonalContext,
} from "../personal-context-service";
import { generateNextMoves } from "../../game/recommendation-engine";
import type {
  Chapter,
  DailyState,
  Destination,
  Milestone,
  QuestRun,
  GameSnapshot,
  ChangeProposal,
} from "../../game/types";
import { createAttributes, createDeviceId, createProfile, createSettings } from "../../data/seed";

function createMockSnapshot(overrides?: Partial<GameSnapshot>): GameSnapshot {
  return {
    profile: createProfile(new Date().toISOString()),
    settings: createSettings(createDeviceId()),
    blueprint: null,
    destinations: [],
    milestones: [],
    boosts: [],
    drains: [],
    quests: [],
    questRuns: [],
    dailyStates: [],
    events: [],
    attributes: createAttributes(),
    trophies: [],
    ...overrides,
  };
}

describe("Section 24: Core Product Evaluation Test Suite", () => {
  // Case 1: User creates a new six-month goal
  it("Case 1: parses and clarifies a 6-month goal proposal", () => {
    const raw = {
      type: "goal_clarification",
      goal: "Finish AI project",
      desired_outcome: "A functional local MVP",
      deadline: "6 months",
      scope: "Core engine, persistence, and basic local UI",
      constraints: ["Busy with college classes", "Low daily discipline"],
      success_condition: "All test cases pass and daily loop works",
      current_state: "Architecture drafted",
      unknowns: ["Which local model is fastest"],
      clarifying_question: null,
      ready_for_campaign: true,
      confidence: 0.9,
    };

    const parsed = goalClarificationSchema.parse(raw);
    expect(parsed.goal).toBe("Finish AI project");
    expect(parsed.ready_for_campaign).toBe(true);

    const readiness = evaluateInterviewReadiness(parsed, 1);
    expect(readiness.ready).toBe(true);
    expect(readiness.nextQuestion).toBeNull();
  });

  // Case 2: User gives incomplete project information -> Ask useful questions
  it("Case 2: detects incomplete information and asks a single high-value question", () => {
    const raw = {
      type: "situation_understanding",
      explicit_facts: ["User wants to finish project"],
      uncertain_info: ["Target deadline", "Definition of finished"],
      missing_critical_info: ["Timeframe", "Scope"],
      assumptions: [],
      clarifying_questions: ["What does 'finished' mean for this project?"],
      ready_for_action: false,
      confidence: 0.5,
    };

    const parsed = situationUnderstandingSchema.parse(raw);
    expect(parsed.ready_for_action).toBe(false);
    expect(parsed.clarifying_questions.length).toBe(1);

    const readiness = evaluateInterviewReadiness({ goal: "Finish project" }, 0);
    expect(readiness.ready).toBe(false);
    expect(readiness.nextQuestion).toContain("finished");
  });

  // Case 3: User reports partial progress -> Deterministic engine does NOT falsely mark complete
  it("Case 3: evaluates partial progress accurately without hallucinating complete state", () => {
    const rawReport = {
      type: "daily_interpretation",
      activity_summary: "Worked 40 mins on API integration",
      duration_minutes: 40,
      completed_work: ["Fixed endpoint error"],
      remaining_work: ["Authentication flow"],
      constraints_noted: ["Exhausted from college"],
      energy_estimate: 2,
      blockers: ["Auth token refresh"],
      user_reported_outcome: "partial" as const,
      uncertainty_notes: [],
      confidence: 0.85,
    };

    const parsed = dailyInterpretationSchema.parse(rawReport);
    expect(parsed.user_reported_outcome).toBe("partial");

    const milestones: Milestone[] = [
      { id: "m1", destinationId: "d1", title: "API endpoints", done: true, createdAt: "2026-08-21" },
      { id: "m2", destinationId: "d1", title: "Authentication", done: false, createdAt: "2026-08-21" },
      { id: "m3", destinationId: "d1", title: "Database sync", done: false, createdAt: "2026-08-21" },
    ];

    const progressState = calculateProgressState(milestones);
    expect(progressState).toBe("in_progress");
    expect(progressState).not.toBe("complete");
  });

  // Case 4: User misses several days -> Non-punitive recovery, restart smaller
  it("Case 4: generates low-friction recovery without punishment when returning after misses", () => {
    const snapshot = createMockSnapshot();
    const nextMoves = generateNextMoves({
      config: snapshot.settings.economy,
      boosts: [],
      destinations: [],
      runs: [],
      today: { id: "2026-08-21", energy: 2, mood: 2, availableMinutes: 15, note: "returning after 4 days", updatedAt: "2026-08-21" },
      momentum: 10, // Below floor
      blueprint: null,
      needsRecovery: true,
      seed: 42,
    });

    const recoveryOption = nextMoves.find((m) => m.category === "recovery");
    expect(recoveryOption).toBeDefined();
    expect(recoveryOption?.durationMinutes).toBeLessThanOrEqual(10);
    expect(recoveryOption?.difficulty).toBe("trivial");
  });

  // Case 5: User has low available time -> Smaller Next Move / Minimum Win
  it("Case 5: clamps Next Move duration and includes Minimum Win when time is constrained", () => {
    const snapshot = createMockSnapshot();
    const nextMoves = generateNextMoves({
      config: snapshot.settings.economy,
      boosts: [],
      destinations: [],
      runs: [],
      today: { id: "2026-08-21", energy: 3, mood: 3, availableMinutes: 10, note: "short break", updatedAt: "2026-08-21" },
      momentum: 50,
      blueprint: null,
      needsRecovery: false,
      seed: 123,
    });

    for (const move of nextMoves) {
      expect(move.durationMinutes).toBeLessThanOrEqual(10);
      expect(move.minimumWin).toBeDefined();
      expect(move.minimumWin?.durationMinutes).toBe(5);
    }
  });

  // Case 6: User's deadline changes -> Localized campaign adaptation
  it("Case 6: enforces prerequisite checks and chapter adaptation when parameters change", () => {
    const chapters: Chapter[] = [
      { id: "c1", destinationId: "d1", title: "Backend Core", order: 1, description: "API setup", progressState: "complete", milestoneIds: ["m1"], createdAt: "2026-08-21" },
      { id: "c2", destinationId: "d1", title: "Auth Flow", order: 2, description: "Auth tokens", progressState: "in_progress", milestoneIds: ["m2"], createdAt: "2026-08-21" },
      { id: "c3", destinationId: "d1", title: "UI Polish", order: 3, description: "Styling", progressState: "not_started", milestoneIds: ["m3"], createdAt: "2026-08-21" },
    ];

    const canStartC2 = validateChapterPrerequisites(chapters, "c2");
    expect(canStartC2.allowed).toBe(true);

    const canStartC3 = validateChapterPrerequisites(chapters, "c3");
    expect(canStartC3.allowed).toBe(false);
    expect(canStartC3.reason).toContain("Auth Flow");

    // Localized adaptation: resize c2 without modifying c1 or c3
    const adapted = adaptChapterScope(chapters, "c2", { title: "Simplified Auth Flow" });
    expect(adapted[1]?.title).toBe("Simplified Auth Flow");
    expect(adapted[0]?.title).toBe("Backend Core");
    expect(adapted[2]?.title).toBe("UI Polish");
  });

  // Case 7: User changes project scope -> Proposal validation and audit log
  it("Case 7: validates structured change proposals and records audit log", () => {
    const dest: Destination = {
      id: "d1",
      title: "Full Stack App",
      description: "App with 10 features",
      priority: 1,
      attributes: ["craft"],
      progress: 20,
      status: "active",
      isBoss: false,
      bossMaxHp: 100,
      bossHp: 80,
      createdAt: "2026-08-21",
    };

    const snapshot = createMockSnapshot({ destinations: [dest] });

    const proposal: ChangeProposal = {
      id: "prop_1",
      proposedBy: "ai",
      targetType: "destination",
      targetId: "d1",
      changeType: "resize",
      summary: "Reduce scope to core MVP",
      rationale: "User skipped 60-minute blocks repeatedly over the last 14 days",
      evidenceSummary: "10 missed long sessions recorded",
      diffPayload: { description: "App with 3 core features" },
      status: "proposed",
      createdAt: "2026-08-21",
    };

    const validation = validateChangeProposal(snapshot, proposal);
    expect(validation.valid).toBe(true);

    const audit = createAuditEntry(proposal, { scope: "10 features" }, { scope: "3 features" });
    expect(audit.proposalId).toBe("prop_1");
    expect(audit.actor).toBe("ai");
    expect(audit.action).toBe("resize_destination");
  });

  // Case 8: User reports contradictory information -> Reflection schema captures uncertainty
  it("Case 8: parses plan-vs-actual reflection highlighting wrong assumptions and blockers", () => {
    const rawReflection = {
      type: "reflection_adaptation",
      plan_vs_actual: "Planned 2h coding, completed 20m due to college lab",
      wrong_assumptions: ["Assumed free afternoon on Thursdays"],
      recurring_blockers: ["College schedule variance"],
      useful_patterns: ["Short 15m sessions right after dinner work consistently"],
      simplification_opportunities: ["Split 60m blocks into 15m focus sessions"],
      proposed_changes: [
        {
          target_type: "routine" as const,
          target_id: null,
          change_type: "update" as const,
          summary: "Adjust Thursday target to 15m",
          rationale: "Accommodates recurring college lab",
          diff_payload: { weekday: "thursday", minutes: 15 },
        },
      ],
      confidence: 0.85,
    };

    const parsed = reflectionAdaptationSchema.parse(rawReflection);
    expect(parsed.wrong_assumptions.length).toBe(1);
    expect(parsed.proposed_changes[0]?.change_type).toBe("update");
  });

  // Case 9: Small context window -> 6-layer context budgeting and hierarchical compression
  it("Case 9: builds compact 6-layer context respecting token limits and inclusion reasoning", () => {
    const snapshot = createMockSnapshot({
      dailyStates: [
        { id: "2026-08-21", energy: 4, mood: 4, availableMinutes: 45, note: "Good focus", updatedAt: "2026-08-21" },
      ],
      questRuns: [
        {
          id: "r1",
          questId: "q1",
          questName: "API Setup",
          startedAt: "2026-08-21T10:00:00Z",
          endedAt: "2026-08-21T10:30:00Z",
          outcome: "completed",
          verification: "verified",
          sparksAwarded: 25,
          comboAtCompletion: 1,
          rushRequested: false,
          rushHit: null,
          missReason: null,
          missNote: null,
          energyAtStart: 4,
          moodAtStart: 4,
          momentumAtStart: 50,
        },
      ],
    });

    const context = buildPersonalContext(snapshot, 60, {
      turnQuery: "Give me the next best move",
      minimal: true,
    });

    expect(context.approxTokens).toBeLessThan(1000);
    expect(context.inclusionRationales.length).toBeGreaterThanOrEqual(3);
    expect(context.currentState?.capacityMinutes).toBe(45);

    // Test Hierarchical Summaries
    const dailySummary = generateDailySummary("2026-08-21", snapshot.questRuns, snapshot.dailyStates[0]!);
    expect(dailySummary.completedQuests).toContain("API Setup");

    const weeklySummary = generateWeeklySummary(2026, 34, [dailySummary]);
    expect(weeklySummary.sessionCount).toBe(1);

    const campaignSummary = generateCampaignSummary(
      { id: "d1", title: "AI Life RPG", description: "", priority: 1, attributes: ["craft"], progress: 50, status: "active", isBoss: false, bossMaxHp: 100, bossHp: 50, createdAt: "2026-08-21" },
      "Core Engine",
      [weeklySummary],
    );
    expect(campaignSummary.progressState).toBe("in_progress");
  });

  // Case 10: Imperfect speech/transcription input & Memory Promotion Rules
  it("Case 10: evaluates memory promotion correctly distinguishing explicit facts from temporary observations", () => {
    const explicit = evaluateMemoryPromotion("I prefer coding in the morning", 1, true);
    expect(explicit.promoteToLongTerm).toBe(true);
    expect(explicit.kind).toBe("FACT");

    const repeated = evaluateMemoryPromotion("User skips sessions when gaming starts", 4, false);
    expect(repeated.promoteToLongTerm).toBe(true);
    expect(repeated.kind).toBe("OBSERVED_PATTERN");

    const singleTransient = evaluateMemoryPromotion("User sounded tired once", 1, false);
    expect(singleTransient.promoteToLongTerm).toBe(false);
    expect(singleTransient.kind).toBe("AI_HYPOTHESIS");
  });
});
