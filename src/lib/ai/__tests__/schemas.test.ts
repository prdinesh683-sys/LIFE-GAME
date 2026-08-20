import { describe, expect, it } from "vitest";

import {
  MalformedAiResponseError,
  extractJson,
  goalPlanSchema,
  missAnalysisSchema,
  nextMoveSchema,
  parseStructured,
  questSchema,
} from "../schemas";

describe("AI response validation", () => {
  it("extracts JSON out of chatty model output", () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it("rejects output with no JSON at all", () => {
    expect(() => extractJson("I cannot help with that")).toThrow();
  });

  it("accepts a well-formed quest proposal", () => {
    const parsed = parseStructured(
      questSchema,
      JSON.stringify({ quest: { name: "Walk outside", duration_minutes: 20 } }),
    );
    expect(parsed.quest.name).toBe("Walk outside");
    expect(parsed.quest.difficulty).toBe("normal");
  });

  it("rejects a quest proposal with an impossible duration", () => {
    expect(() =>
      parseStructured(questSchema, JSON.stringify({ quest: { name: "Forever" } })),
    ).toThrow(MalformedAiResponseError);
  });

  it("rejects a next-move recommendation missing its fields", () => {
    expect(() =>
      parseStructured(nextMoveSchema, JSON.stringify({ recommendations: [{ title: "Walk" }] })),
    ).toThrow(MalformedAiResponseError);
  });

  it("treats an empty recommendation list as valid but empty", () => {
    expect(parseStructured(nextMoveSchema, JSON.stringify({ recommendations: [] })).recommendations)
      .toEqual([]);
  });

  it("rejects a malformed goal plan as a whole", () => {
    expect(() => parseStructured(goalPlanSchema, JSON.stringify({ nope: true }))).toThrow(
      MalformedAiResponseError,
    );
  });

  it("rejects a miss analysis that is not an object", () => {
    expect(() => parseStructured(missAnalysisSchema, JSON.stringify(["nope"]))).toThrow(
      MalformedAiResponseError,
    );
  });
});
