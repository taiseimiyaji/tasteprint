import { z } from "zod";
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const px = z.number().min(0).max(512);
const text = z.string().trim().max(1000);
export const foundationFields = {
  canvas: color.default("#f8f8f4"),
  surface: color.default("#ffffff"),
  ink: color.default("#282c25"),
  muted: color.default("#878b80"),
  borderColor: color.default("#e9e9e3"),
  success: color.default("#327554"),
  warning: color.default("#946500"),
  danger: color.default("#b34040"),
  focus: color.default("#526f99"),
  fontFamily: z
    .enum(["sans-serif", "serif", "monospace"])
    .default("sans-serif"),
  heading1: px.default(28),
  heading2: px.default(22),
  heading3: px.default(18),
  lineHeight: z.number().min(1).max(3).default(1.5),
  bodyWeight: z.number().int().min(100).max(900).default(400),
  headingWeight: z.number().int().min(100).max(900).default(600),
  spacingScale: z
    .array(px)
    .min(2)
    .max(16)
    .refine(
      (v) => v.every((n, i) => i === 0 || n > v[i - 1]),
      "昇順で重複のない値を入力してください",
    )
    .default([0, 4, 8, 12, 16, 24, 32, 48]),
  pagePadding: px.default(24),
  sectionGap: px.default(24),
  controlHeight: z.number().min(24).max(100).default(36),
  rowHeight: z.number().min(24).max(160).default(48),
  radiusNone: z.literal(0).default(0),
  radiusXs: px.default(2),
  radiusSm: px.default(4),
  radiusLg: px.default(12),
  radiusPill: z.number().min(0).max(9999).default(9999),
  radiusUsage: text.default("md: 面、sm: コントロール、pill: バッジ"),
  borderWidth: z.number().min(0).max(8).default(1),
  borderPolicy: text.default("一覧の行を区切る"),
  shadowX: px.default(0),
  shadowY: px.default(5),
  shadowBlur: px.default(18),
  shadowSpread: z.number().min(-100).max(100).default(0),
  shadowColor: color.default("#222222"),
  shadowOpacity: z.number().min(0).max(1).default(0.08),
  shadowAllowed: text.default("Dialog、Popover"),
  duration: z.number().int().min(0).max(5000).default(160),
  easing: z
    .enum(["linear", "ease", "ease-in", "ease-out", "ease-in-out"])
    .default("ease-out"),
  reducedMotion: z.enum(["none", "instant"]).default("none"),
  compactBreakpoint: z.number().int().min(240).max(2000).default(480),
  mediumBreakpoint: z.number().int().min(240).max(3000).default(768),
  wideBreakpoint: z.number().int().min(240).max(4000).default(1200),
  compactPolicy: text.default("ナビゲーションを畳み、テーブルを横スクロール"),
  mediumPolicy: text.default("ナビゲーションを畳む"),
  widePolicy: text.default("サイドバーと本文を横並び"),
};
export const fieldGroups = {
  Colors: [
    "accent",
    "canvas",
    "surface",
    "ink",
    "muted",
    "borderColor",
    "success",
    "warning",
    "danger",
    "focus",
  ],
  Typography: [
    "fontSize",
    "fontFamily",
    "heading1",
    "heading2",
    "heading3",
    "lineHeight",
    "bodyWeight",
    "headingWeight",
  ],
  Spacing: [
    "spacing",
    "spacingScale",
    "pagePadding",
    "sectionGap",
    "controlHeight",
    "rowHeight",
  ],
  Radius: [
    "radius",
    "radiusNone",
    "radiusXs",
    "radiusSm",
    "radiusLg",
    "radiusPill",
    "radiusUsage",
  ],
  Borders: ["border", "borderWidth", "borderColor", "borderPolicy"],
  Shadows: [
    "shadow",
    "shadowX",
    "shadowY",
    "shadowBlur",
    "shadowSpread",
    "shadowColor",
    "shadowOpacity",
    "shadowAllowed",
  ],
  Motion: ["duration", "easing", "reducedMotion"],
  Breakpoints: [
    "compactBreakpoint",
    "mediumBreakpoint",
    "wideBreakpoint",
    "compactPolicy",
    "mediumPolicy",
    "widePolicy",
  ],
} as const;
export const fieldNames = [
  ...new Set([
    ...Object.values(fieldGroups).flat(),
    "components" as const,
    "patterns" as const,
  ]),
];
export const fieldNameSchema = z.enum([...fieldNames] as [string, ...string[]]);
export const decisionSchema = z
  .object({
    locked: z.boolean(),
    scope: text,
    exceptions: text,
    rationale: text,
    source: text,
    author: z.enum(["user", "ai", "default"]),
  })
  .strict();
export const constraintsSchema = z
  .partialRecord(fieldNameSchema, decisionSchema)
  .default({});
export const emptyDecision: z.infer<typeof decisionSchema> = {
  locked: false,
  scope: "全画面",
  exceptions: "",
  rationale: "",
  source: "",
  author: "user",
};
export function changedFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  return fieldNames.filter(
    (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  );
}
