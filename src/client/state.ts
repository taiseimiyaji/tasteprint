import { z } from "zod";
import { findingSchema } from "../domain/reference";
import { defaultDesign, designSchema } from "../domain/design";
const referenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  aspects: z.array(z.string()),
  image: z.string().optional(),
  principles: z.array(findingSchema).optional(),
});
export type Reference = z.infer<typeof referenceSchema>;
export const stateSchema = z.preprocess(
  (value) => {
    if (
      value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === 1
    )
      return { ...value, version: 2 };
    return value;
  },
  z.object({
    version: z.literal(2),
    design: designSchema,
    answers: z.record(
      z.string(),
      z.enum(["a", "b", "both", "neither", "skip"]),
    ),
    references: z.array(referenceSchema),
  }),
);
export type WorkspaceState = z.infer<typeof stateSchema>;
export const initialState: WorkspaceState = {
  version: 2,
  design: defaultDesign,
  answers: {},
  references: [
    {
      id: "linear",
      name: "Linear",
      url: "https://linear.app",
      aspects: ["Typography", "Density"],
    },
    {
      id: "stripe",
      name: "Stripe",
      url: "https://stripe.com",
      aspects: ["Colors", "Forms"],
    },
    {
      id: "vercel",
      name: "Vercel",
      url: "https://vercel.com",
      aspects: ["Navigation", "Spacing"],
    },
  ],
};
export const legacyStorageKey = "tasteprint.mock.v1";
export const storageKey = "tasteprint.workspace.v3";
export function loadState(): WorkspaceState {
  try {
    const value =
      localStorage.getItem(storageKey) ??
      localStorage.getItem("tasteprint.workspace.v2") ??
      localStorage.getItem(legacyStorageKey);
    return value ? stateSchema.parse(JSON.parse(value)) : initialState;
  } catch {
    return initialState;
  }
}

export function loadLegacyReferences(): Reference[] {
  try {
    const value = localStorage.getItem(legacyStorageKey);
    const imported: string[] = JSON.parse(
      localStorage.getItem("tasteprint.references.imported") || "[]",
    );
    return value
      ? stateSchema
          .parse(JSON.parse(value))
          .references.filter(
            (r) =>
              !["linear", "stripe", "vercel"].includes(r.id) &&
              !imported.includes(r.id),
          )
      : [];
  } catch {
    return [];
  }
}
