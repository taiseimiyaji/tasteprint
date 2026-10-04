import { z } from "zod";
import { selectionSchema } from "../domain/reference";
import { stateSchema } from "./state";

// Drafts may be incomplete or exceed the API's save limits. Validate the
// structure used by editors without trimming or discarding those edits.
const principle = z
  .object({
    id: z.string(),
    target: z.string(),
    text: z.string(),
    reason: z.string(),
    sources: z.array(z.string()),
    locked: z.boolean(),
  })
  .passthrough();
const brief = z
  .object({
    name: z.string(),
    purpose: z.string(),
    audience: z.string(),
    desired: z.string(),
    avoid: z.string(),
  })
  .passthrough();
const revision = z.number().int().min(1);
const profile = z
  .object({
    baseProfileRevision: z.number().int().min(0),
    answers: z.record(
      z.string(),
      z.enum(["a", "b", "both", "neither", "skip"]),
    ),
    reasons: z.record(z.string(), z.string()),
    principles: z.array(principle),
  })
  .passthrough();
const overview = z
  .object({
    baseRevision: revision,
    brief,
    policies: z.array(principle),
  })
  .passthrough();
const reference = z
  .object({
    name: z.string(),
    url: z.string().default(""),
    selections: z.array(selectionSchema.passthrough()),
    likes: z.string().default(""),
    dislikes: z.string().default(""),
  })
  .passthrough();

export const parseBriefDraft = (stored: unknown) => brief.parse(stored);
export const parseProfileDraft = (stored: unknown) => profile.parse(stored);
export const parseOverviewDraft = (stored: unknown) => overview.parse(stored);
export const parsePositionDraft = (stored: unknown) =>
  z.number().int().parse(stored);
export const parseUseTasteDraft = (stored: unknown) =>
  z.boolean().parse(stored);
export const parseReferenceInputDraft = (stored: unknown) =>
  reference.parse(stored);
export function parseWorkspaceDraft(stored: unknown, currentRevision: number) {
  const state = stateSchema.parse(stored);
  return {
    state,
    baseRevision: Object.hasOwn(stored as object, "baseRevision")
      ? revision.parse((stored as { baseRevision: unknown }).baseRevision)
      : currentRevision,
  };
}
