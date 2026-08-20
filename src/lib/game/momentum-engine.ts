import type { ActivityEvent, DailyState, EconomyConfig } from "./types";

/**
 * MomentumEngine — Momentum 🌊 is a deterministic 0-100 score derived from
 * recent real-world activity. The LLM never computes this.
 */

export interface MomentumBreakdown {
  value: number;
  completions: number;
  misses: number;
  hoursSinceLastAction: number | null;
  label: string;
}

const LOOKBACK_HOURS = 72;

export function momentumLabel(value: number): string {
  if (value >= 80) return "Surging";
  if (value >= 60) return "Rolling";
  if (value >= 35) return "Building";
  if (value >= 15) return "Flickering";
  return "Dormant";
}

export function computeMomentum(params: {
  config: EconomyConfig;
  events: ActivityEvent[];
  today: DailyState | null;
  nowIso: string;
}): MomentumBreakdown {
  const { config, events, nowIso } = params;
  const now = Date.parse(nowIso);
  const windowed = events.filter((e) => {
    const age = (now - Date.parse(e.timestamp)) / 3600000;
    return age >= 0 && age <= LOOKBACK_HOURS;
  });

  let score = 0;
  let completions = 0;
  let misses = 0;
  let lastActionAt: number | null = null;

  for (const event of windowed) {
    const ts = Date.parse(event.timestamp);
    const ageHours = (now - ts) / 3600000;
    const decay = Math.max(0, 1 - (ageHours * config.momentumDecayPerHour) / 100);

    if (
      event.type === "quest_completed" ||
      event.type === "recovery_completed" ||
      event.type === "boost_logged"
    ) {
      const rawWeight = event.payload["difficultyWeight"];
      const difficultyWeight = typeof rawWeight === "number" ? rawWeight : 1;
      score += config.momentumPerCompletion * decay * difficultyWeight;
      completions += 1;
      if (lastActionAt === null || ts > lastActionAt) lastActionAt = ts;
    }

    if (event.type === "quest_missed") {
      score -= config.momentumMissPenalty * decay;
      misses += 1;
    }
  }

  const value = Math.max(0, Math.min(100, Math.round(score)));
  return {
    value,
    completions,
    misses,
    hoursSinceLastAction: lastActionAt === null ? null : (now - lastActionAt) / 3600000,
    label: momentumLabel(value),
  };
}