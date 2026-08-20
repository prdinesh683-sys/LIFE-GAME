import { describe, expect, it } from "vitest";

import { draftsToRecords, parseMemoryProposals, reviewProposals, suggestDeletion } from "../memory-proposals";
import { buildMemoryArchive } from "../memory-archive";
import type { MemoryRecord } from "../../ai/records";

const raw = (memories: unknown[]) => ({ type: "memory_proposal", memories });

describe("AI memory proposals", () => {
  it("rejects malformed AI output outright", () => {
    expect(parseMemoryProposals({ nonsense: true })).toBeNull();
    expect(reviewProposals("not json").accepted).toHaveLength(0);
  });

  it("keeps unproven claims as hypotheses, never as facts", () => {
    const review = reviewProposals(
      raw([
        {
          kind: "FACT",
          text: "Mornings work best",
          supporting_evidence_ids: ["e1"],
          related_entity_ids: [],
          confidence: 0.9,
        },
      ]),
    );
    expect(review.accepted[0]?.kind).toBe("AI_HYPOTHESIS");
  });

  it("promotes a claim that carries enough of the player's own records", () => {
    const review = reviewProposals(
      raw([
        {
          kind: "OBSERVED_PATTERN",
          text: "Evening runs get skipped",
          supporting_evidence_ids: ["e1", "e2"],
          related_entity_ids: [],
          confidence: 0.6,
        },
      ]),
      { knownEvidenceIds: ["e1", "e2"] },
    );
    expect(review.accepted[0]?.kind).toBe("OBSERVED_PATTERN");
  });

  it("drops evidence ids this device does not know", () => {
    const review = reviewProposals(
      raw([
        {
          kind: "OBSERVED_PATTERN",
          text: "Invented backing",
          supporting_evidence_ids: ["ghost1", "ghost2"],
          related_entity_ids: [],
          confidence: 0.6,
        },
      ]),
      { knownEvidenceIds: ["e1"] },
    );
    expect(review.accepted[0]?.supportingEvidenceIds).toEqual([]);
    expect(review.accepted[0]?.kind).toBe("AI_HYPOTHESIS");
  });

  it("only becomes a stored memory through the approval path", () => {
    const review = reviewProposals(
      raw([
        {
          kind: "AI_HYPOTHESIS",
          text: "You prefer short quests",
          supporting_evidence_ids: [],
          related_entity_ids: [],
          confidence: 0.3,
        },
      ]),
    );
    let n = 0;
    const rows = draftsToRecords(review.accepted, (prefix) => `${prefix}_${(n += 1)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("mem_1");
  });

  it("can only suggest deletion, never perform it", () => {
    expect(suggestDeletion("mem_1", "outdated").requiresUserApproval).toBe(true);
  });
});

describe("selective Drive archive", () => {
  const memory = (id: string): MemoryRecord =>
    ({ id, text: `memory ${id}`, kind: "FACT", status: "active" }) as unknown as MemoryRecord;

  it("uploads exactly the selected memories and never the whole store", () => {
    const file = buildMemoryArchive({
      memories: [memory("m1"), memory("m2"), memory("m3")],
      selectedIds: ["m2"],
      deviceId: "device-a",
    });
    expect(file.memories).toHaveLength(1);
    expect(file.memories[0]?.id).toBe("m2");
  });

  it("refuses an empty selection instead of defaulting to everything", () => {
    expect(() =>
      buildMemoryArchive({ memories: [memory("m1")], selectedIds: [], deviceId: "device-a" }),
    ).toThrow();
  });
});
