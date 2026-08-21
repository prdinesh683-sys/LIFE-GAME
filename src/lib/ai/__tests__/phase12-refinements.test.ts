import { describe, expect, it } from "vitest";
import {
  sanitizeContextForCloud,
  sanitizeTextForCloud,
  buildPersonalContext,
} from "../personal-context-service";
import { generateNextMoves } from "../../game/recommendation-engine";
import { dailyInterpretationSchema } from "../schemas";
import { createAttributes, createDeviceId, createProfile, createSettings } from "../../data/seed";
import type { GameSnapshot } from "../../game/types";

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

describe("Phase 12: Evidence-Based Refinements Test Suite", () => {
  // CHANGE 1: Home Dashboard Minimum Win Shortcut
  describe("CHANGE 1: Minimum Win Visibility & Selection", () => {
    it("attaches Minimum Win micro-action to recommendations", () => {
      const snapshot = createMockSnapshot();
      const nextMoves = generateNextMoves({
        config: snapshot.settings.economy,
        boosts: [],
        destinations: [],
        runs: [],
        today: { id: "2026-08-21", energy: 2, mood: 2, availableMinutes: 15, note: "tired", updatedAt: "2026-08-21" },
        momentum: 40,
        blueprint: null,
        needsRecovery: false,
        seed: 1,
      });

      const primary = nextMoves[0];
      expect(primary).toBeDefined();
      expect(primary?.minimumWin).toBeDefined();
      expect(primary?.minimumWin?.durationMinutes).toBe(5);
      expect(primary?.minimumWin?.title).toContain("5-minute micro");
    });

    it("ensures normal capacity users have access to standard full actions as primary", () => {
      const snapshot = createMockSnapshot();
      const nextMoves = generateNextMoves({
        config: snapshot.settings.economy,
        boosts: [],
        destinations: [],
        runs: [],
        today: { id: "2026-08-21", energy: 4, mood: 4, availableMinutes: 45, note: "fresh", updatedAt: "2026-08-21" },
        momentum: 70,
        blueprint: null,
        needsRecovery: false,
        seed: 1,
      });

      const primary = nextMoves[0];
      expect(primary).toBeDefined();
      expect(primary?.durationMinutes).toBeGreaterThanOrEqual(15);
    });
  });

  // CHANGE 2: Natural Language Report Extraction & Validation
  describe("CHANGE 2: Natural Language Report Validation Pipeline", () => {
    it("parses natural language progress report into strict schema before confirmation", () => {
      const rawReport = {
        type: "daily_interpretation",
        activity_summary: "Worked 20m on authentication integration",
        duration_minutes: 20,
        completed_work: ["Added JWT refresh route"],
        remaining_work: ["Client token storage"],
        constraints_noted: ["Tired evening"],
        energy_estimate: 3,
        blockers: [],
        user_reported_outcome: "partial" as const,
        uncertainty_notes: [],
        confidence: 0.9,
      };

      const parsed = dailyInterpretationSchema.parse(rawReport);
      expect(parsed.duration_minutes).toBe(20);
      expect(parsed.completed_work).toContain("Added JWT refresh route");
      expect(parsed.user_reported_outcome).toBe("partial");
    });

    it("rejects malformed natural language report payload gracefully", () => {
      const badReport = {
        type: "daily_interpretation",
        activity_summary: "Did some work",
        duration_minutes: -10, // Invalid duration
      };

      const result = dailyInterpretationSchema.safeParse(badReport);
      expect(result.success).toBe(false);
    });
  });

  // CHANGE 3: Cloud Fallback Privacy Sanitization
  describe("CHANGE 3: Cloud Fallback Privacy Sanitization", () => {
    it("sanitizes Windows absolute paths", () => {
      const input = "Saved in H:\\lovable project\\game-life-advisor-main\\src\\file.ts";
      const sanitized = sanitizeTextForCloud(input);
      expect(sanitized).not.toContain("H:\\");
      expect(sanitized).toContain("[local_path]");
    });

    it("sanitizes Unix absolute paths", () => {
      const input = "Stored at /Users/developer/code/project/data.json";
      const sanitized = sanitizeTextForCloud(input);
      expect(sanitized).not.toContain("/Users/developer");
      expect(sanitized).toContain("[local_path]");
    });

    it("sanitizes file:/// URLs", () => {
      const input = "Check file:///c:/Users/admin/vault/notes.md";
      const sanitized = sanitizeTextForCloud(input);
      expect(sanitized).not.toContain("file:///");
      expect(sanitized).toContain("[local_file]");
    });

    it("preserves semantic content while stripping machine identifiers", () => {
      const snapshot = createMockSnapshot();
      const context = buildPersonalContext(snapshot, 50, {
        turnQuery: "Plan project located at C:\\Users\\User\\MyProject",
      });

      const sanitized = sanitizeContextForCloud(context);
      const serialized = JSON.stringify(sanitized);

      expect(serialized).not.toContain("C:\\Users\\User\\MyProject");
      expect(serialized).toContain("[local_path]");
      expect(sanitized.currentState?.identity.rank).toBe(1);
    });
  });
});
