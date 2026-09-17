import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { designSchema, type Design } from "../../domain/design";
import { designCss, designVariables } from "../../domain/tokens";
import { projectMarkdown } from "../../domain/project-export";
import type { ProjectSnapshot } from "../../domain/projects";
import {
  briefSchema,
  tasteSchema,
  principleSchema,
} from "../../domain/projects";
import { z } from "zod";

export const templateVersion = "preview-1";
export const openQuestions = [
  "Components / Patterns の個別仕様・全状態は未確認（Preview テンプレートの動作例）",
  "実アプリでの設計・アクセシビリティレビューが必要",
];
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const color = (hex: string) => ({
  colorSpace: "srgb",
  components: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
  alpha: 1,
});
export function dtcg(design: Design) {
  const d = designSchema.parse(design);
  const tokens: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(designVariables(d))) {
    const key = name.slice(2);
    if (value.startsWith("#"))
      tokens[key] = { $type: "color", $value: color(value) };
    else if (/^\d+(\.\d+)?px$/.test(value))
      tokens[key] = {
        $type: "dimension",
        $value: { value: parseFloat(value), unit: "px" },
      };
    else if (/^\d+ms$/.test(value))
      tokens[key] = {
        $type: "duration",
        $value: { value: parseFloat(value), unit: "ms" },
      };
    else if (name === "--font-family")
      tokens[key] = { $type: "fontFamily", $value: value };
    else if (/weight$/.test(name))
      tokens[key] = { $type: "fontWeight", $value: Number(value) };
    else if (name === "--line-height")
      tokens[key] = { $type: "number", $value: Number(value) };
  }
  const shadow = {
    $type: "shadow",
    $value: {
      color: { ...color(d.shadowColor), alpha: d.shadowOpacity },
      offsetX: { value: d.shadowX, unit: "px" },
      offsetY: { value: d.shadowY, unit: "px" },
      blur: { value: d.shadowBlur, unit: "px" },
      spread: { value: d.shadowSpread, unit: "px" },
    },
  };
  tokens["floating-shadow"] = shadow;
  if (d.shadow)
    tokens["surface-shadow"] = { $type: "shadow", $value: "{floating-shadow}" };
  if (d.border)
    tokens["row-border"] = {
      $type: "border",
      $value: {
        color: "{color-border-color}",
        width: "{border-width}",
        style: "solid",
      },
    };
  const easing = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1],
    "ease-in-out": [0.42, 0, 0.58, 1],
  };
  tokens["motion-easing"] = { $type: "cubicBezier", $value: easing[d.easing] };
  return {
    $extensions: {
      "tasteprint.export": {
        format: "2025.10",
        disabled: { rowBorder: !d.border, surfaceShadow: !d.shadow },
        reducedMotion: d.reducedMotion,
      },
    },
    ...tokens,
  };
}
function source(path: string) {
  const built = new URL(`./export-templates/${path}`, import.meta.url);
  return readFileSync(
    existsSync(built) ? built : new URL(`../../${path}`, import.meta.url),
    "utf8",
  );
}
export function bundleFiles(input: {
  revision: number;
  design: Design;
  snapshot: ProjectSnapshot;
  decisions?: {
    targetPath: string;
    rationale: string;
    source: string;
    author: string;
  }[];
}) {
  const r = structuredClone(input);
  z.number().int().positive().parse(r.revision);
  z.string().min(1).parse(r.snapshot.projectId);
  z.boolean().parse(r.snapshot.taste.confirmed);
  r.design = designSchema.parse(r.design);
  briefSchema.parse(r.snapshot.brief);
  tasteSchema.parse(r.snapshot.taste);
  z.array(principleSchema).parse(r.snapshot.policies);
  // Only adopted source evidence is public; never serialize the raw snapshot.
  const references = [...r.snapshot.taste.references, ...r.snapshot.references]
    .map((raw) => {
      const ref = z
        .object({
          name: z.string(),
          url: z.string(),
          accepted: z.array(z.number().int().nonnegative()),
          analysis: z
            .object({
              findings: z.array(
                z.object({
                  aspect: z.string(),
                  recommendation: z.string(),
                  interpretation: z.string(),
                  evidence: z.string(),
                }),
              ),
            })
            .nullish(),
        })
        .parse(raw);
      return {
        name: ref.name,
        url: cleanUrl(ref.url),
        principles: ref.accepted.map((i) => {
          const finding = ref.analysis?.findings[i];
          if (!finding) throw new Error("採用した参考分析の構造が不正です。");
          return finding;
        }),
      };
    })
    .filter((r) => r.principles.length);
  // Markdown uses the same allowlisted reference projection.
  r.snapshot.references = references.map((ref) => ({
    ...ref,
    selections: [],
    analysis: { findings: ref.principles },
    accepted: ref.principles.map((_, i) => i),
  }));
  r.snapshot.taste.references = [];
  const metadata = {
    projectId: r.snapshot.projectId,
    revision: r.revision,
    sourceTasteProfileRevision: r.snapshot.sourceTasteProfileRevision,
    status: "Draft",
    schemaVersion: "foundation-1",
    templateVersion,
  };
  const files: Record<string, string> = {
    "DESIGN.md":
      projectMarkdown(r)
        .replace("Tasteprint mockup export", "Tasteprint revision export")
        .replace("## Borders\n", "## Borders and Shadows\n")
        .replace("## Breakpoints\n", "## Responsive Behavior\n")
        .replace("## Rules and Exceptions\n", "## Exceptions\n") +
      `\n## Decision Priorities\n\n保存したロック・適用範囲・例外とプロジェクト固有方針を参照してください。未採用提案は含みません。\n\n## Visual Hierarchy\n\nh1: ${r.design.heading1}px / h2: ${r.design.heading2}px / h3: ${r.design.heading3}px / body: ${r.design.fontSize}px。適用例は同梱の3画面です。\n\n## Components\n\nButton、Input、Select と Preview は同じ静的テンプレートから出力しています。全状態・個別仕様の確認は未完了です。\n\n## Do / Don't\n\n${r.snapshot.policies.map((p) => `- ${p.target}: ${p.text}（理由: ${p.reason || "未記入"}）`).join("\n") || "固有の指示は未設定です。"}\n\n## Export Open Questions\n\n${openQuestions.map((q) => `- ${q}`).join("\n")}\n`,
    "design-system.json": json({
      ...metadata,
      design: r.design,
      brief: r.snapshot.brief,
      policies: r.snapshot.policies,
      taste: {
        answers: r.snapshot.taste.answers,
        reasons: r.snapshot.taste.reasons,
        principles: r.snapshot.taste.principles,
        confirmed: r.snapshot.taste.confirmed,
      },
      references,
      decisions: r.decisions,
      openQuestions,
    }),
    "tokens/tokens.json": json({
      ...dtcg(r.design),
      $description: `Project ${metadata.projectId}, revision ${r.revision}, Draft`,
    }),
    "tokens/variables.css": `/* revision ${r.revision} */\n${designCss(r.design)}`,
    "ui/components/Preview.tsx": source(
      "client/components/Preview.tsx",
    ).replaceAll('"../../domain/', '"../domain/'),
    "ui/components/TemplateControls.tsx": source(
      "client/components/TemplateControls.tsx",
    ),
    "ui/styles.css": source("client/styles.css"),
    "ui/domain/design.ts": source("domain/design.ts"),
    "ui/domain/foundation.ts": source("domain/foundation.ts"),
    "ui/domain/tokens.ts": source("domain/tokens.ts"),
    "ui/design.ts": `import type { Design } from './domain/design';\nexport const design: Design = ${json(r.design)};\n`,
    "ui/index.ts": `export * from './components/TemplateControls';\nexport { Preview } from './components/Preview';\nexport * from './patterns/pages';\n`,
    "ui/patterns/pages.tsx": `import { Preview } from '../components/Preview';\nimport { design } from '../design';\nimport '../styles.css';\n${["List", "Settings", "Form"].map((name) => `export function ${name}Page() { return <Preview design={design} screen="${name.toLowerCase()}" />; }`).join("\n")}\n`,
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["ui", "examples"],
    }),
    "ui/css.d.ts": 'declare module "*.css";\n',
  };
  for (const name of ["List", "Settings", "Form"])
    files[`examples/${name}Page.tsx`] =
      `export { ${name}Page as default } from '../ui/patterns/pages';\n`;
  return { files, metadata };
}
function cleanUrl(value: string) {
  if (!value) return "";
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
export function finishBundle(
  files: Record<string, string>,
  metadata: ReturnType<typeof bundleFiles>["metadata"],
  images: Record<string, Buffer>,
  root: string,
) {
  const pkg = JSON.parse(source("../package.json"));
  const dependencies = Object.fromEntries(
    [
      "react",
      "react-dom",
      "lucide-react",
      "zod",
      "@fontsource-variable/dm-sans",
      "@fontsource-variable/manrope",
    ].map((name) => [name, pkg.dependencies[name]]),
  );
  files["package.json"] = json({
    name: "tasteprint-export",
    private: true,
    type: "module",
    scripts: { typecheck: "tsc --noEmit" },
    dependencies,
    devDependencies: Object.fromEntries(
      ["typescript", "@types/react", "@types/react-dom"].map((name) => [
        name,
        pkg.devDependencies[name],
      ]),
    ),
  });
  files["README.md"] =
    `# Tasteprint r${metadata.revision} — Draft\n\nこの ZIP は保存済みの同一 revision から生成しました。\n\n## 導入\n\nNode.js 22.13 以上で npm install、npm run typecheck を実行してください。React アプリへ ui と examples をコピーし、examples/ListPage（SettingsPage / FormPage）を表示します。CSS import に対応した Vite 等の bundler が必要です。テンプレート CSS は workspace のスタイルも含むため、専用 iframe または独立ページで利用してください。\n\nPNG: ${Object.keys(images).length ? "Preview と同じレンダラー、1440 × 1000、初期状態" : "ユーザーが画像なし出力を明示的に選択"}。\n\n## 未確認事項\n\n${openQuestions.map((q) => `- ${q}`).join("\n")}\n\n依存バージョンは package.json、出力内容の SHA-256 は manifest.json を参照してください。確認環境: Node.js 22 以上、TypeScript、React、Chromium（リポジトリの自動検証）。\n`;
  const bytes = Object.fromEntries([
    ...Object.entries(files).map(([n, v]) => [n, Buffer.from(v)] as const),
    ...Object.entries(images),
  ]);
  files["manifest.json"] = json({
    ...metadata,
    images: Object.keys(images).length ? "complete" : "omitted",
    openQuestions,
    dependencies,
    dtcgVersion: "2025.10",
    files: Object.entries(bytes).map(([path, data]) => ({
      path,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    })),
  });
  bytes["manifest.json"] = Buffer.from(files["manifest.json"]);
  return {
    files,
    images,
    zip: Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(bytes).map(([path, data]) => [
            `${root}/${path}`,
            data,
          ]),
        ),
      ),
    ),
  };
}
