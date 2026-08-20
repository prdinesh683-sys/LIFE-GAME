import type { Difficulty, EconomyConfig, Profile } from "./types";

/**
 * RewardEngine — deterministic Sparks, Rank, Combo and Surge math.
 * Pure functions only: no storage, no randomness, no AI.
 */

export function sparksForQuest(
  config: EconomyConfig,
  durationMinutes: number,
  difficulty: Difficulty,
): number {
  const base = durationMinutes * config.baseSparksPerMinute;
  return Math.max(1, Math.round(base * config.difficultyMultiplier[difficulty]));
}

export function comboMultiplier(config: EconomyConfig, combo: number): number {
  const steps = Math.max(0, combo - 1);
  return Math.min(config.comboMaxMultiplier, 1 + steps * config.comboBonusPerStep);
}

/** Combos only survive inside the configured window of real activity. */
export function nextCombo(
  config: EconomyConfig,
  currentCombo: number,
  lastCompletionIso: string | null,
  nowIso: string,
): number {
  if (!lastCompletionIso) return 1;
  const elapsedMinutes = (Date.parse(nowIso) - Date.parse(lastCompletionIso)) / 60000;
  if (elapsedMinutes > config.comboWindowMinutes) return 1;
  return currentCombo + 1;
}

export function rankThreshold(config: EconomyConfig, rank: number): number {
  return Math.round(config.rankCurveBase * Math.pow(config.rankCurveGrowth, rank - 1));
}

/** Total lifetime Sparks needed to have reached the start of `rank`. */
export function cumulativeForRank(config: EconomyConfig, rank: number): number {
  let total = 0;
  for (let r = 1; r < rank; r++) total += rankThreshold(config, r);
  return total;
}

export function rankForLifetimeSparks(config: EconomyConfig, lifetimeSparks: number): number {
  let rank = 1;
  let spent = 0;
  while (rank < 200) {
    const need = rankThreshold(config, rank);
    if (lifetimeSparks < spent + need) break;
    spent += need;
    rank += 1;
  }
  return rank;
}

export interface RankProgress {
  rank: number;
  intoRank: number;
  needed: number;
  ratio: number;
}

export function rankProgress(config: EconomyConfig, lifetimeSparks: number): RankProgress {
  const rank = rankForLifetimeSparks(config, lifetimeSparks);
  const floor = cumulativeForRank(config, rank);
  const needed = rankThreshold(config, rank);
  const intoRank = lifetimeSparks - floor;
  return { rank, intoRank, needed, ratio: Math.min(1, intoRank / needed) };
}

export interface RewardOutcome {
  baseSparks: number;
  comboMultiplier: number;
  surgeBonus: number;
  totalSparks: number;
  combo: number;
  surge: boolean;
  rankBefore: number;
  rankAfter: number;
  rankUp: boolean;
}

export function resolveReward(params: {
  config: EconomyConfig;
  profile: Profile;
  durationMinutes: number;
  difficulty: Difficulty;
  lastCompletionIso: string | null;
  nowIso: string;
}): RewardOutcome {
  const { config, profile, durationMinutes, difficulty, lastCompletionIso, nowIso } = params;
  const combo = nextCombo(config, profile.combo, lastCompletionIso, nowIso);
  const multiplier = comboMultiplier(config, combo);
  const baseSparks = sparksForQuest(config, durationMinutes, difficulty);
  const surge = combo > 0 && combo % config.surgeThreshold === 0;
  const surgeBonus = surge ? config.surgeBonusSparks : 0;
  const totalSparks = Math.round(baseSparks * multiplier) + surgeBonus;
  const rankBefore = rankForLifetimeSparks(config, profile.lifetimeSparks);
  const rankAfter = rankForLifetimeSparks(config, profile.lifetimeSparks + totalSparks);
  return {
    baseSparks,
    comboMultiplier: multiplier,
    surgeBonus,
    totalSparks,
    combo,
    surge,
    rankBefore,
    rankAfter,
    rankUp: rankAfter > rankBefore,
  };
}