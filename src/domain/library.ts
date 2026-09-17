import { z } from "zod";
export const componentNames = [
  "Button",
  "Input",
  "Select",
  "Checkbox",
  "Tabs",
  "Dialog",
  "Table",
  "Badge",
] as const;
export const patternNames = [
  "PageHeader",
  "FilterBar",
  "ListPage",
  "SettingsSection",
  "FormSection",
  "EmptyState",
] as const;
export type ComponentName = (typeof componentNames)[number];
export type PatternName = (typeof patternNames)[number];
export const applicableStates = {
  Button: ["default", "hover", "focus", "disabled", "loading"],
  Input: ["default", "hover", "focus", "disabled", "error"],
  Select: ["default", "hover", "focus", "disabled", "error"],
  Checkbox: ["default", "hover", "focus", "disabled", "error"],
  Tabs: ["default", "hover", "focus", "disabled"],
  Dialog: ["default", "focus"],
  Table: ["default", "loading"],
  Badge: ["default"],
} as const;
const text = z.string().max(1000);
export const componentConfigSchema = z
  .object({
    variant: z.enum(["solid", "outline", "subtle"]),
    size: z.enum(["sm", "md", "lg"]),
    states: z
      .array(
        z.enum(["default", "hover", "focus", "disabled", "error", "loading"]),
      )
      .min(1)
      .max(6),
    usage: text,
    rules: text,
    rationale: text,
  })
  .strict();
const componentsShape = Object.fromEntries(
  componentNames.map((name) => [
    name,
    componentConfigSchema.refine(
      (c) =>
        c.states.includes("default") &&
        new Set(c.states).size === c.states.length &&
        c.states.every((s) =>
          (applicableStates[name] as readonly string[]).includes(s),
        ),
      "適用可能な状態を重複なく指定し、defaultを含めてください",
    ),
  ]),
) as unknown as Record<
  ComponentName,
  z.ZodType<z.infer<typeof componentConfigSchema>>
>;
export const defaultComponents = Object.fromEntries(
  componentNames.map((name) => [
    name,
    {
      variant: name === "Button" ? "solid" : "outline",
      size: "md",
      states: [...applicableStates[name]],
      usage: `${name}の標準的な操作・表示`,
      rules: "ラベルとフォーカスを明確にする",
      rationale: "一貫した操作と読みやすさを保つ",
    },
  ]),
) as Record<ComponentName, z.infer<typeof componentConfigSchema>>;
export const componentsSchema = z.object(componentsShape).strict();
export const patternSlots = {
  PageHeader: ["title", "action"],
  FilterBar: ["tabs", "search", "filter"],
  ListPage: ["PageHeader", "FilterBar", "Table", "EmptyState"],
  SettingsSection: ["fields", "save", "danger"],
  FormSection: ["fields", "submit", "help"],
  EmptyState: ["message", "action"],
} as const;
const refs: Record<PatternName, ComponentName[]> = {
  PageHeader: ["Button"],
  FilterBar: ["Tabs", "Input", "Select"],
  ListPage: ["Table", "Badge"],
  SettingsSection: ["Input", "Select", "Checkbox", "Button", "Dialog"],
  FormSection: ["Input", "Select", "Checkbox", "Button"],
  EmptyState: ["Button"],
};
export const patternConfigSchema = z
  .object({
    structure: z.array(z.string()).min(2).max(4),
    gap: z.number().int().min(0).max(96),
    components: z.array(z.enum(componentNames)).min(1).max(8),
    responsive: z.enum(["stack", "wrap"]),
    usage: text,
    avoid: text,
    rationale: text,
  })
  .strict();
export const defaultPatterns = Object.fromEntries(
  patternNames.map((name) => [
    name,
    {
      structure: [...patternSlots[name]],
      gap: 16,
      components: refs[name],
      responsive: "stack",
      usage: `${name}で情報と操作をまとめる`,
      avoid: "操作と無関係な情報を混在させない",
      rationale: "情報の順序と余白で構造を伝える",
    },
  ]),
) as Record<PatternName, z.infer<typeof patternConfigSchema>>;
const patternsShape = Object.fromEntries(
  patternNames.map((name) => [
    name,
    patternConfigSchema.refine(
      (p) =>
        p.structure.length === patternSlots[name].length &&
        new Set(p.structure).size === p.structure.length &&
        p.structure.every((s) =>
          (patternSlots[name] as readonly string[]).includes(s),
        ) &&
        new Set(p.components).size === p.components.length,
      "構造には既定の要素を一度ずつ含め、参照は重複させないでください",
    ),
  ]),
) as unknown as Record<
  PatternName,
  z.ZodType<z.infer<typeof patternConfigSchema>>
>;
export const patternsSchema = z.object(patternsShape).strict();

/** Leaf-level review data; arrays remain a single, readable decision. */
export function configurationDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix = "",
): { path: string; before: unknown; after: unknown }[] {
  return Object.keys(after).flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key,
      a = before[key],
      b = after[key];
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    )
      return configurationDiff(
        a as Record<string, unknown>,
        b as Record<string, unknown>,
        path,
      );
    return [{ path, before: a, after: b }];
  });
}
export function affectedScreens(path: string): string {
  const pattern = path.split(".")[1];
  if (path.startsWith("patterns.")) {
    if (pattern === "SettingsSection") return "Settings";
    if (pattern === "FormSection") return "Form";
    if (pattern !== "PageHeader") return "List";
  }
  if (/^components\.(Table|Badge|Tabs)\./.test(path)) return "List";
  if (path.startsWith("components.Checkbox.")) return "Settings / Form";
  return "List / Settings / Form";
}
