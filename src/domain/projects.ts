import { z } from "zod";
import { questions, profile, type Choice } from "./design";
export const principleSchema = z.object({
  id: z.string().min(1).max(150),
  target: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(2000),
  reason: z.string().max(2000),
  sources: z.array(z.string().max(4000)).max(30),
  locked: z.boolean().default(false),
});
export type Principle = z.infer<typeof principleSchema>;
export const tasteSchema = z.object({
  answers: z
    .record(
      z.string().refine((id) => questions.some((q) => q.id === id)),
      z.enum(["a", "b", "both", "neither", "skip"]),
    )
    .default({}),
  reasons: z.record(z.string().max(100), z.string().max(2000)).default({}),
  principles: z
    .array(principleSchema)
    .max(100)
    .refine(
      (p) => new Set(p.map((v) => v.id)).size === p.length,
      "原則IDが重複しています",
    ),
});
export type TasteInput = z.infer<typeof tasteSchema>;
export type TasteSnapshot = TasteInput & {
  dna: ReturnType<typeof profile>;
  questionVersion: string;
  comparisons: typeof questions;
  references: unknown[];
  confirmed: boolean;
};
export type TasteRevision = {
  revision: number;
  createdAt: string;
  snapshot: TasteSnapshot;
};
export const briefSchema = z.object({
  name: z.string().trim().min(1).max(100),
  purpose: z.string().max(2000).default(""),
  audience: z.string().max(2000).default(""),
  desired: z.string().max(2000).default(""),
  avoid: z.string().max(2000).default(""),
});
export type Brief = z.infer<typeof briefSchema>;
export type ProjectSnapshot = {
  projectId: string;
  brief: Brief;
  sourceTasteProfileRevision: number | null;
  taste: TasteSnapshot;
  policies: Principle[];
  references: unknown[];
  maintained: { key: string; reason: string }[];
};
export type TasteDiff = {
  key: string;
  kind: "追加" | "変更" | "削除";
  before: unknown;
  after: unknown;
  conflict: string | null;
};
export const emptyTaste = (): TasteSnapshot => ({
  answers: {},
  dna: profile({}),
  reasons: {},
  principles: [],
  questionVersion: "taste-v1",
  comparisons: questions,
  references: [],
  confirmed: false,
});
export function tasteDiff(
  snapshot: ProjectSnapshot,
  latest: TasteSnapshot,
  constraints: Record<string, unknown>,
): TasteDiff[] {
  const flatten = (taste: TasteSnapshot): Record<string, unknown> => ({
    ...Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(taste.answers),
          ...Object.keys(taste.reasons),
        ]),
      ].map((k) => [
        `answer:${k}`,
        { choice: taste.answers[k] ?? null, reason: taste.reasons[k] || "" },
      ]),
    ),
    ...Object.fromEntries(
      taste.principles.map((p) => [`principle:${p.id}`, p]),
    ),
    ...Object.fromEntries(
      taste.references.map((r, i) => [
        `reference:${(r as { id?: string }).id ?? i}`,
        r,
      ]),
    ),
    confirmation: taste.confirmed,
  });
  const a = flatten(snapshot.taste),
    b = flatten(latest);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((key) => {
      const principle = (b[key] || a[key]) as Principle;
      const target = key.startsWith("principle:")
        ? principle.target
        : key.startsWith("answer:")
          ? key.slice(7).split("-")[0]
          : "";
      const aliases: Record<string, string[]> = {
        roundness: ["radius"],
        density: ["spacing"],
        shadowEmphasis: ["shadow"],
        borderEmphasis: ["border"],
        cardUsage: ["list"],
      };
      const targets = [target, ...(aliases[target] || [])];
      const own = snapshot.policies.find((p) => targets.includes(p.target));
      const locked = targets.find((t) => constraints[t]);
      return {
        key,
        kind:
          a[key] === undefined
            ? "追加"
            : b[key] === undefined
              ? "削除"
              : "変更",
        before: a[key] ?? null,
        after: b[key] ?? null,
        conflict: own
          ? `固有指定「${own.text}」を保持します。${own.reason}`
          : locked
            ? `${locked} の明示指定・ロックを保持します。`
            : null,
      };
    });
}
export function mergeTaste(
  current: TasteSnapshot,
  latest: TasteSnapshot,
  selected: string[],
): TasteSnapshot {
  const result = structuredClone(current);
  for (const key of selected) {
    if (key.startsWith("answer:")) {
      const id = key.slice(7);
      if (latest.answers[id]) result.answers[id] = latest.answers[id] as Choice;
      else delete result.answers[id];
      if (latest.reasons[id]) result.reasons[id] = latest.reasons[id];
      else delete result.reasons[id];
    }
    if (key.startsWith("principle:")) {
      const id = key.slice(10);
      result.principles = result.principles.filter((p) => p.id !== id);
      const p = latest.principles.find((p) => p.id === id);
      if (p) result.principles.push(structuredClone(p));
    }
    if (key.startsWith("reference:")) {
      const id = key.slice(10),
        identify = (r: unknown, i: number) =>
          String((r as { id?: string }).id ?? i);
      const next = latest.references.find((r, i) => identify(r, i) === id);
      result.references = result.references.filter(
        (r, i) => identify(r, i) !== id,
      );
      if (next) result.references.push(structuredClone(next));
    }
    if (key === "confirmation") result.confirmed = latest.confirmed;
  }
  result.dna = profile(result.answers);
  return result;
}
