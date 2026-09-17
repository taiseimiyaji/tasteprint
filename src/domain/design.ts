import { z } from "zod";
import {
  componentsSchema,
  patternsSchema,
  defaultComponents,
  defaultPatterns,
} from "./library";

import { foundationFields, constraintsSchema, fieldGroups } from "./foundation";

export const designSchema = z
  .object({
    ...foundationFields,
    components: componentsSchema.default(defaultComponents),
    patterns: patternsSchema.default(defaultPatterns),
    constraints: constraintsSchema,
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    radius: z.number().int().min(0).max(20),
    spacing: z.number().int().min(8).max(24),
    fontSize: z.number().int().min(12).max(18),
    border: z.boolean(),
    shadow: z.boolean(),
  })
  .strict()
  .refine(
    (d) =>
      d.compactBreakpoint < d.mediumBreakpoint &&
      d.mediumBreakpoint < d.wideBreakpoint,
    "Breakpointsはcompact < medium < wideにしてください",
  )
  .refine(
    (d) => d.heading1 >= d.heading2 && d.heading2 >= d.heading3,
    "見出しサイズはh1 ≥ h2 ≥ h3にしてください",
  );
export type Design = z.infer<typeof designSchema>;
export const defaultDesign: Design = designSchema.parse({
  accent: "#65764d",
  radius: 6,
  spacing: 14,
  fontSize: 14,
  border: true,
  shadow: false,
});
export const axes = [
  "density",
  "roundness",
  "decoration",
  "contrast",
  "borderEmphasis",
  "shadowEmphasis",
  "cardUsage",
] as const;
export const questions = axes.flatMap((axis, index) =>
  [0, 1].map((round) => ({
    id: `${axis}-${round}`,
    axis,
    title: [
      "どちらの情報量が、心地よいですか？",
      "角の仕上げは、どちらが好みですか？",
      "どちらの表情が、しっくりきますか？",
      "情報の強弱は、どちらが好みですか？",
      "境界は、どちらが見やすいですか？",
      "奥行きは、どちらが自然ですか？",
      "情報のまとまりは、どちらが好みですか？",
    ][index],
    labels: [
      ["余白で呼吸をつくる", "一覧性を高める"],
      ["直線的でシャープ", "丸くやわらかい"],
      ["静かで控えめ", "装飾で表情をつくる"],
      ["穏やかな強弱", "はっきりした強弱"],
      ["余白で区切る", "罫線で区切る"],
      ["フラットに整える", "影で奥行きをつくる"],
      ["連続したリスト", "独立したカード"],
    ][index],
    context: round === 0 ? "プロジェクトの一覧" : "最近のアクティビティ",
  })),
);
export type Choice = "a" | "b" | "both" | "neither" | "skip";
export function profile(answers: Record<string, Choice>) {
  return Object.fromEntries(
    axes.map((axis) => {
      const values = questions
        .filter((q) => q.axis === axis)
        .flatMap((q) => {
          const a = answers[q.id];
          return a === "a"
            ? [0.2]
            : a === "b"
              ? [0.8]
              : a === "both"
                ? [0.5]
                : [];
        });
      return [
        axis,
        values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null,
      ];
    }),
  );
}
export function designMarkdown(
  design: Design,
  answers: Record<string, Choice>,
  references: {
    name: string;
    url: string;
    aspects: string[];
    principles?: {
      aspect: string;
      recommendation: string;
      evidence: string;
      interpretation: string;
    }[];
  }[],
  snapshot?: {
    revision: number;
    decisions?: {
      targetPath: string;
      rationale: string;
      source: string;
      author: string;
    }[];
  },
) {
  return `# Design System\n\n> Draft · Tasteprint mockup export\n> ${references.some((r) => r.principles?.length) ? "採用済みの参考分析を含みます。設計全体のAIレビューは未実施。" : "Codexによる分析・レビューは未実施。"}数値はユーザーが現在選択した設定です。\n\n## Design Philosophy\n\n自分が選んだ理由を大切にし、情報の見やすさを実画面で確認する。\n\n## Foundation\n\n- Accent: ${design.accent}\n- Body font size: ${design.fontSize}px\n- Row padding: ${design.spacing}px\n- Surface radius: ${design.radius}px\n- Row separators: ${design.border ? "enabled" : "disabled"}\n- Static surface shadow: ${design.shadow ? "enabled" : "disabled"}\n\n${Object.entries(
    fieldGroups,
  )
    .map(
      ([group, keys]) =>
        `## ${group}\n\n${keys.map((key) => `- ${key}: ${JSON.stringify(design[key])}`).join("\n")}`,
    )
    .join("\n\n")}\n\n## Rules and Exceptions\n\n${
    Object.entries(design.constraints)
      .map(([key, rule]) =>
        rule
          ? `- ${key} (${rule.locked ? "AI変更禁止" : "編集可能"})\n  適用範囲: ${rule.scope}\n  例外: ${rule.exceptions || "なし"}\n  理由: ${rule.rationale || "未記入"}\n  出典: ${rule.source || "未記入"} (${rule.author})`
          : "",
      )
      .join("\n") || "未設定"
  }\n\n## Revision decisions\n\n${snapshot ? `revision ${snapshot.revision}\n${(snapshot.decisions ?? []).map((d) => `- ${d.targetPath}: ${d.rationale}（${d.source} / ${d.author}）`).join("\n")}` : "未確定"}\n\n## Taste Profile\n\n${JSON.stringify(profile(answers), null, 2)}\n\n## Components\n\n${JSON.stringify(design.components, null, 2)}\n\n## Pattern Settings\n\n${JSON.stringify(design.patterns, null, 2)}\n\n## Application Patterns\n\n### List\nPageHeader → FilterBar → Table / EmptyState\n\n### Settings\nPageHeader → SettingsSection → SaveAction\n\n### Form\nPageHeader → FormSection → Validation → SubmitAction\n\n## References\n\n${references.map((r) => `- ${r.name}${r.url ? ` (${r.url})` : ""}: ${r.aspects.join(", ")}`).join("\n")}\n\n## Adopted Reference Principles\n\n${references.flatMap((r) => (r.principles ?? []).map((p) => `- ${p.aspect}: ${p.recommendation}\n  理由: ${p.interpretation}\n  根拠: ${p.evidence}（出典: ${r.url || r.name}）`)).join("\n") || "未採用"}\n\n## Open Questions\n\n- 未採用の参考分析の確認\n- コンポーネントの全状態とアクセシビリティ検証\n- 実アプリでの設計レビュー\n`;
}
