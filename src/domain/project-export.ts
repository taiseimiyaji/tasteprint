import { designMarkdown, type Design } from "./design";
import type { ProjectSnapshot } from "./projects";
import type { SavedReference } from "./reference";
export function projectMarkdown(revision: {
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
  const s = revision.snapshot;
  const refs = (
    [...s.taste.references, ...s.references] as SavedReference[]
  ).map((r) => ({
    name: r.name,
    url: r.url,
    aspects: r.selections.map((v) => v.aspect),
    principles: r.accepted.map((i) => r.analysis!.findings[i]).filter(Boolean),
  }));
  const rules = (values: ProjectSnapshot["policies"]) =>
    values
      .map(
        (p) =>
          `- ${p.target}: ${p.text}\n  理由: ${p.reason || "未記入"}\n  出典: ${p.sources.join(", ") || "未記入"}\n  ロック: ${p.locked ? "あり" : "なし"}`,
      )
      .join("\n") || "未設定";
  return (
    `<!-- ${JSON.stringify({ projectId: s.projectId, revision: revision.revision, sourceTasteProfileRevision: s.sourceTasteProfileRevision })} -->\n` +
    designMarkdown(revision.design, s.taste.answers, refs, revision) +
    `\n## Project\n\n- 名前: ${s.brief.name}\n- 用途: ${s.brief.purpose}\n- 対象ユーザー: ${s.brief.audience}\n- 目指す印象: ${s.brief.desired}\n- 避けたい印象: ${s.brief.avoid}\n\n## 共通の好みから採用\n\n参照版: ${s.sourceTasteProfileRevision ?? "なし"}\n質問版: ${s.taste.questionVersion}\n確認状態: ${s.taste.confirmed ? "確定" : "未確認"}\n\n${rules(s.taste.principles)}\n\n## このプロジェクト固有の方針・例外\n\n${rules(s.policies)}\n\n## 共通更新で維持した判断\n\n${s.maintained.map((m) => `- ${m.key}: ${m.reason}`).join("\n") || "なし"}\n\n## Tasteの回答と理由\n\n${s.taste.comparisons.map((q) => `- ${q.id} (${q.context}): ${s.taste.answers[q.id] ?? "未回答"} — ${s.taste.reasons[q.id] || "理由未記入"}`).join("\n")}\n`
  );
}
