import type { EconomyConfig } from "./types";

/**
 * Every reward number in the game comes from here, never from a literal in a
 * component. The user can edit these values in System Settings → Game.
 */
export const DEFAULT_ECONOMY: EconomyConfig = {
  baseSparksPerMinute: 1.5,
  difficultyMultiplier: {
    trivial: 0.6,
    easy: 0.85,
    normal: 1,
    hard: 1.35,
    extreme: 1.8,
  },
  comboBonusPerStep: 0.15,
  comboMaxMultiplier: 2,
  surgeThreshold: 3,
  surgeBonusSparks: 40,
  comboWindowMinutes: 240,
  rankCurveBase: 120,
  rankCurveGrowth: 1.35,
  runGraceDays: 1,
  momentumDecayPerHour: 3,
  momentumPerCompletion: 14,
  momentumMissPenalty: 8,
  recoveryMomentumFloor: 15,
  attributePointsPerQuest: 10,
};