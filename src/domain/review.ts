import { z } from "zod";
import type { Design } from "./design";
export const findingSchema = z
  .object({
    ruleId: z.string().min(1).max(200),
    targetPath: z.string().min(1).max(500),
    severity: z.enum(["info", "warning", "error"]),
    evidence: z.string().min(1).max(4000),
    explanation: z.string().min(1).max(2000),
    suggestedChange: z.string().min(1).max(2000),
  })
  .strict();
export const reviewOutput = z
  .object({ findings: z.array(findingSchema).max(50) })
  .strict();
export type Finding = z.infer<typeof findingSchema> & {
  id: string;
  source: "machine" | "ai";
  dismissal?: string;
};
export type ReviewRule = { id: string; description: string };
export type Review = {
  id: string;
  baseRevision: number;
  createdAt: string;
  design: Design;
  dna: unknown;
  rules: ReviewRule[];
  findings: Finding[];
  verifiedRules: string[];
  scope: string[];
  images: string[];
  status: "complete" | "partial";
  error?: string;
  stale?: boolean;
};
export const machineRules: ReviewRule[] = [
  {
    id: "states",
    description:
      "ボタン・入力のhover・focus-visible・disabledスタイル、および必須入力のinvalidスタイルの定義",
  },
  { id: "tokens", description: "参照するCSS変数が解決できる" },
  {
    id: "shadow",
    description:
      "shadow=falseなら影を禁止。Preview面の影はshadowAllowedの列挙にPreviewがある場合のみ許可",
  },
  {
    id: "radius",
    description:
      "面・コントロールの角丸は設定の最大値以下（バッジ・アバターを除く）",
  },
  {
    id: "focus",
    description: "入力・ボタンにキーボードフォーカスの視覚的変化がある",
  },
];
