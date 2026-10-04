import { describe, expect, it } from "vitest";
import {
  parseBriefDraft,
  parseOverviewDraft,
  parsePositionDraft,
  parseProfileDraft,
  parseReferenceInputDraft,
  parseUseTasteDraft,
  parseWorkspaceDraft,
} from "../src/client/draft-shapes";
import { initialState } from "../src/client/state";

const brief = { name: "", purpose: "", audience: "", desired: "", avoid: "" };
const principle = {
  id: "unfinished",
  target: "",
  text: "",
  reason: "",
  sources: [],
  locked: false,
};
describe("editable draft structure", () => {
  it("preserves incomplete, whitespace and over-limit edits instead of applying save constraints", () => {
    const value = {
      ...brief,
      purpose: `  ${"x".repeat(2500)}  `,
      extra: "keep",
    };
    expect(parseBriefDraft(value)).toEqual(value);
    const overview = {
      baseRevision: 1,
      brief: value,
      policies: [{ ...principle, sources: Array(40).fill("x".repeat(4500)) }],
      extra: "keep",
    };
    expect(parseOverviewDraft(overview)).toEqual(overview);
  });
  it("preserves Profile snapshot metadata and unfinished principles", () => {
    const value = {
      baseProfileRevision: 0,
      answers: { "density-0": "skip" },
      reasons: {},
      principles: [principle],
      dna: { density: null },
      comparisons: [{ id: "keep" }],
      questionVersion: "taste-v1",
      references: [{ id: "keep" }],
      confirmed: false,
    };
    expect(parseProfileDraft(value)).toEqual(value);
  });
  it("rejects missing or wrongly typed nested fields before editors use them", () => {
    expect(() => parseProfileDraft({})).toThrow();
    expect(() =>
      parseProfileDraft({
        baseProfileRevision: 0,
        answers: {},
        reasons: {},
        principles: [{ ...principle, sources: "wrong" }],
      }),
    ).toThrow();
    expect(() => parseOverviewDraft({})).toThrow();
    expect(() =>
      parseOverviewDraft({ baseRevision: 1, brief, policies: [{}] }),
    ).toThrow();
    expect(() => parseBriefDraft({ ...brief, name: [] })).toThrow();
  });
  it("does not coerce booleans or fractional/nonfinite positions", () => {
    expect(parseUseTasteDraft(false)).toBe(false);
    expect(() => parseUseTasteDraft("false")).toThrow();
    for (const value of ["oops", 1.5, NaN, Infinity])
      expect(() => parsePositionDraft(value)).toThrow();
    // Existing comparison rendering clamps integral legacy positions.
    expect(parsePositionDraft(100)).toBe(100);
  });
  it("preserves reference drafts with empty selections and long notes", () => {
    const value = {
      name: "  reference  ",
      url: "",
      selections: [],
      likes: "x".repeat(2200),
      dislikes: "",
      baseVersion: null,
      extra: "keep",
    };
    expect(parseReferenceInputDraft(value)).toEqual(value);
    expect(() =>
      parseReferenceInputDraft({ ...value, selections: {} }),
    ).toThrow();
    expect(() => parseReferenceInputDraft({ ...value, likes: [] })).toThrow();
    expect(
      parseReferenceInputDraft({ name: "legacy", selections: [] }),
    ).toEqual({
      name: "legacy",
      url: "",
      selections: [],
      likes: "",
      dislikes: "",
    });
  });
  it("keeps known Workspace migration and missing-base behavior", () => {
    const value = { ...initialState, version: 1 };
    const draft = parseWorkspaceDraft(value, 7);
    expect(draft.state.version).toBe(2);
    expect(draft.state.design).toEqual(initialState.design);
    expect(draft.baseRevision).toBe(7);
    expect(
      parseWorkspaceDraft({ ...value, baseRevision: 2 }, 7).baseRevision,
    ).toBe(2);
  });
  it("rejects a present bad Workspace base instead of adopting the current revision", () => {
    for (const baseRevision of [null, "2", 0, -1, 1.5])
      expect(() =>
        parseWorkspaceDraft({ ...initialState, baseRevision }, 7),
      ).toThrow();
  });
});
