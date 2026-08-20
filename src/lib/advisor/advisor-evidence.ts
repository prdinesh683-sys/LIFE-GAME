import type { EvidenceItem, EvidenceScore, EvidenceStrength } from "./advisor-types";

/**
 * Deterministic evidence scoring. Confidence is never taken from the model:
 * the AI may only claim a confidence up to what the evidence supports.
 */

const KIND_WEIGHT = { fact: 1, observation: 0.6, hypothesis: 0.2 } as const;

export function scoreEvidence(evidence: EvidenceItem[], sampleSize: number): EvidenceScore {
  const counts = { fact: 0, observation: 0, hypothesis: 0 };
  let raw = 0;
  for (const item of evidence) {
    counts[item.kind] += 1;
    raw += KIND_WEIGHT[item.kind] * clamp01(item.weight);
  }
  // Sample size caps how much any reasoning is worth.
  const sampleFactor = sampleSize <= 0 ? 0.2 : Math.min(1, 0.35 + sampleSize / 12);
  const score = clamp01((raw / 4) * sampleFactor);
  return {
    score: round2(score),
    strength: strengthFor(score, counts.fact, sampleSize),
    facts: counts.fact,
    observations: counts.observation,
    hypotheses: counts.hypothesis,
    sampleSize,
  };
}

function strengthFor(score: number, facts: number, sampleSize: number): EvidenceStrength {
  if (facts === 0 || sampleSize <= 0) return "insufficient";
  if (score >= 0.6 && facts >= 2) return "strong";
  if (score >= 0.35) return "moderate";
  return "weak";
}

/** The AI's claimed confidence is clamped to the deterministic evidence ceiling. */
export function resolveConfidence(claimed: number | null, score: EvidenceScore): number {
  const ceiling = {
    strong: 0.9,
    moderate: 0.7,
    weak: 0.5,
    insufficient: 0.3,
  }[score.strength];
  const base = claimed == null ? ceiling * 0.8 : clamp01(claimed);
  return round2(Math.min(base, ceiling));
}

export function evidenceFromTrigger(input: {
  facts: string[];
  observations: string[];
  hypotheses: string[];
}): EvidenceItem[] {
  return [
    ...input.facts.map((text) => ({ kind: "fact" as const, text, weight: 1 })),
    ...input.observations.map((text) => ({ kind: "observation" as const, text, weight: 0.8 })),
    ...input.hypotheses.map((text) => ({ kind: "hypothesis" as const, text, weight: 0.5 })),
  ];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}