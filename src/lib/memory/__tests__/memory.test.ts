import { describe, expect, it } from "vitest";

import { normalizeMemory, memorySignature, type MemoryRecord } from "../../ai/records";
import { buildMemory, explainProvenance, isTrusted, provenanceOf } from "../memory-provenance";
import { rescoreAll, scoreMemory } from "../memory-scoring";
import { buildMemoryContext, retrieveMemories, markUsed } from "../memory-retrieval";
import { consolidate, findDuplicates } from "../memory-dedupe";
import { isMeaningfulChange, preferenceTimeline, reviseMemory, currentPreferences } from "../memory-versioning";
import { reviewProposals, suggestDeletion } from "../memory-proposals";
import { memoryHealth } from "../memory-health";
import { buildTimeline } from "../memory-timeline";
import { buildMemoryArchive, parseMemoryArchive } from "../memory-archive";
import { buildLink, memoriesForEntity, relatedMemories } from "../memory-links";

const iso = "2026-01-01T10:00:00.000Z";

function mem(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return normalizeMemory({
    kind: "FACT",
    source: "engine",
    confidence: null,
    createdAt: iso,
    pinned: false,
    ...overrides,
  } as MemoryRecord);
}

describe("provenance", () => {
  it("records where every memory came from", () => {
    const record = buildMemory("m1", {
      kind: "USER_PREFERENCE",
      text: "I train in the morning",
      sourceType: "USER",
      now: iso,
    });
    expect(record.sourceType).toBe("USER");
    expect(record.version).toBe(1);
    expect(record.effectiveFrom).toBe(iso);
    expect(isTrusted(record)).toBe(true);
    expect(provenanceOf(record).trusted).toBe(true);
    expect(explainProvenance(record).length).toBeGreaterThan(10);
  });

  it("treats AI hypotheses and Drive content as untrusted", () => {
    const hypothesis = buildMemory("m2", {
      kind: "AI_HYPOTHESIS",
      text: "You may prefer short quests",
      sourceType: "AI_HYPOTHESIS",
    });
    expect(isTrusted(hypothesis)).toBe(false);
    const drive = buildMemory("m3", { kind: "FACT", text: "From a note", sourceType: "DRIVE" });
    expect(isTrusted(drive)).toBe(false);
  });

  it("backfills pre-4B rows without losing them", () => {
    const legacy = { id: "old", kind: "FACT", text: "legacy", source: "engine", confidence: null, createdAt: iso, pinned: false } as MemoryRecord;
    const normalized = normalizeMemory(legacy);
    expect(normalized.status).toBe("active");
    expect(normalized.version).toBe(1);
    expect(normalized.sourceType).toBeDefined();
  });
});

describe("importance scoring", () => {
  it("is deterministic and repeatable", () => {
    const record = buildMemory("m1", { kind: "USER_PREFERENCE", text: "Evenings are busy", sourceType: "USER", now: iso });
    const a = scoreMemory({ memory: record, now: Date.parse(iso) });
    const b = scoreMemory({ memory: record, now: Date.parse(iso) });
    expect(a.total).toBe(b.total);
  });

  it("ranks confirmed preferences above unsupported hypotheses", () => {
    const pref = buildMemory("p", { kind: "USER_PREFERENCE", text: "No late workouts", sourceType: "USER", now: iso });
    const guess = buildMemory("g", { kind: "AI_HYPOTHESIS", text: "Maybe mornings", sourceType: "AI_HYPOTHESIS", now: iso });
    const scored = rescoreAll([pref, guess], Date.parse(iso));
    const byId = new Map(scored.map((row) => [row.id, row.importanceScore ?? 0]));
    expect(byId.get("p")!).toBeGreaterThan(byId.get("g")!);
  });
});

describe("layered retrieval", () => {
  const rows = [
    buildMemory("a", { kind: "USER_PREFERENCE", text: "I run in the morning before work", sourceType: "USER", now: iso }),
    buildMemory("b", { kind: "OBSERVED_PATTERN", text: "Evening quests are usually missed", sourceType: "OBSERVED_PATTERN", now: iso }),
    buildMemory("c", { kind: "AI_HYPOTHESIS", text: "Reading may relax you", sourceType: "AI_HYPOTHESIS", now: iso }),
  ];

  it("returns a bounded slice, not the whole store", () => {
    const result = retrieveMemories(rows, { text: "morning run", limit: 2 });
    expect(result.memories.length).toBeLessThanOrEqual(2);
  });

  it("prefers direct matches and labels hypotheses separately", () => {
    const pkg = buildMemoryContext(rows, { text: "morning run" });
    expect(pkg.lines[0]?.text).toContain("morning");
    const hypothesis = pkg.lines.find((line) => line.kind === "AI_HYPOTHESIS");
    if (hypothesis) expect(hypothesis.hypothesis).toBe(true);
  });

  it("tracks reuse when memories are used", () => {
    const used = markUsed(rows, ["a"]);
    expect(used.find((row) => row.id === "a")?.useCount).toBe(1);
  });
});

describe("deduplication and consolidation", () => {
  it("finds identical memories by signature", () => {
    const one = mem({ id: "1", text: "I prefer short quests", kind: "USER_PREFERENCE" });
    const two = mem({ id: "2", text: "I  prefer short quests.", kind: "USER_PREFERENCE" });
    expect(memorySignature(one)).toBe(memorySignature(two));
    expect(findDuplicates([one, two])).toHaveLength(1);
  });

  it("keeps provenance and supersedes rather than deletes", () => {
    const one = mem({ id: "1", text: "Same thing", supportingEvidenceIds: ["e1"] });
    const two = mem({ id: "2", text: "Same thing", supportingEvidenceIds: ["e2"] });
    const [group] = findDuplicates([one, two]);
    const result = consolidate(group!, iso);
    expect(result.merged.supportingEvidenceIds).toEqual(expect.arrayContaining(["e1", "e2"]));
    expect(result.superseded[0]?.status).toBe("superseded");
  });
});

describe("preference evolution", () => {
  it("versions a changed preference instead of overwriting it", () => {
    const previous = buildMemory("p1", { kind: "USER_PREFERENCE", text: "Mornings work best", sourceType: "USER", now: iso });
    expect(isMeaningfulChange(previous, "Mornings work best")).toBe(false);
    const { closed, next } = reviseMemory({ previous, id: "p2", text: "Evenings work best now", reason: "changed job" });
    expect(closed.status).toBe("superseded");
    expect(closed.effectiveTo).toBeTruthy();
    expect(next.version).toBe(2);
    expect(next.previousVersionId).toBe("p1");
    const timeline = preferenceTimeline([closed, next], "p2");
    expect(timeline).toHaveLength(2);
    expect(currentPreferences([closed, next]).map((row) => row.id)).toEqual(["p2"]);
  });
});

describe("AI memory proposals", () => {
  it("rejects malformed AI output", () => {
    const review = reviewProposals({ nonsense: true });
    expect(review.accepted).toHaveLength(0);
    expect(review.rejected[0]?.reason).toBe("malformed AI output");
  });

  it("downgrades unsupported claims to hypotheses", () => {
    const review = reviewProposals({
      type: "memory_proposal",
      memories: [{ kind: "FACT", text: "You always train at 6am", supporting_evidence_ids: [] }],
    });
    expect(review.accepted[0]?.kind).toBe("AI_HYPOTHESIS");
  });

  it("keeps evidence-backed patterns as patterns", () => {
    const review = reviewProposals(
      {
        type: "memory_proposal",
        memories: [
          { kind: "OBSERVED_PATTERN", text: "Evening quests are missed", supporting_evidence_ids: ["r1", "r2"] },
        ],
      },
      { knownEvidenceIds: ["r1", "r2"] },
    );
    expect(review.accepted[0]?.kind).toBe("OBSERVED_PATTERN");
  });

  it("can only suggest deletion, never perform it", () => {
    expect(suggestDeletion("m1", "stale").requiresUserApproval).toBe(true);
  });
});

describe("links, timeline, health and archive", () => {
  const memory = buildMemory("m1", { kind: "OBSERVED_PATTERN", text: "Short quests finish", sourceType: "OBSERVED_PATTERN", now: iso });
  const other = buildMemory("m2", { kind: "FACT", text: "Related fact", sourceType: "DETERMINISTIC_EVENT", now: iso });
  const links = [
    buildLink({ id: "l1", memoryId: "m1", relation: "derived_from", targetKind: "questRun", targetId: "run1", label: "evidence", now: iso }),
    buildLink({ id: "l2", memoryId: "m1", relation: "related_to", targetKind: "memory", targetId: "m2", label: "related", now: iso }),
  ];

  it("queries memories by linked entity", () => {
    expect(memoriesForEntity([memory, other], links, "questRun", "run1").map((m) => m.id)).toEqual(["m1"]);
    expect(relatedMemories([memory, other], links, "m1").map((m) => m.id)).toEqual(["m2"]);
  });

  it("builds a chronological learning timeline", () => {
    const entries = buildTimeline({ memories: [memory, other], links });
    expect(entries.length).toBe(2);
    expect(entries.some((entry) => entry.kind === "pattern")).toBe(true);
  });

  it("reports health with actionable notes", () => {
    const dup1 = mem({ id: "d1", text: "duplicate line" });
    const dup2 = mem({ id: "d2", text: "duplicate line" });
    const report = memoryHealth({ memories: [memory, other, dup1, dup2] });
    expect(report.duplicateGroups).toBe(1);
    expect(report.notes.length).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it("only archives explicitly selected memories to Drive", () => {
    const file = buildMemoryArchive({ memories: [memory, other], selectedIds: ["m1"], deviceId: "dev", now: iso });
    expect(file.memories.map((row) => row.id)).toEqual(["m1"]);
    expect(() => buildMemoryArchive({ memories: [memory], selectedIds: [], deviceId: "dev" })).toThrow();
  });

  it("re-flags restored Drive memories as untrusted Drive content", () => {
    const file = buildMemoryArchive({ memories: [memory], selectedIds: ["m1"], deviceId: "dev", now: iso });
    const restored = parseMemoryArchive(file);
    expect(restored[0]?.sourceType).toBe("DRIVE");
    expect(parseMemoryArchive({ kind: "nope" })).toEqual([]);
  });
});
