import { z } from "zod";
import { defaultDesign, designSchema } from "../domain/design";
const referenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  aspects: z.array(z.string()),
  image: z.string().optional(),
});
export type Reference = z.infer<typeof referenceSchema>;
export const stateSchema = z.object({
  version: z.literal(1),
  design: designSchema,
  answers: z.record(z.string(), z.enum(["a", "b", "both", "neither", "skip"])),
  references: z.array(referenceSchema),
});
export type WorkspaceState = z.infer<typeof stateSchema>;
export const initialState: WorkspaceState = {
  version: 1,
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
export const storageKey = "tasteprint.mock.v1";
export function loadState(): WorkspaceState {
  try {
    const value = localStorage.getItem(storageKey);
    return value ? stateSchema.parse(JSON.parse(value)) : initialState;
  } catch {
    return initialState;
  }
}
