import { useEffect, useState } from "react";
import { designSchema, type Design } from "../../domain/design";
import {
  emptyDecision,
  fieldGroups,
  type decisionSchema,
} from "../../domain/foundation";
import type { z } from "zod";
const labels: Record<string, string> = {
  accent: "アクセント色",
  canvas: "画面の背景色",
  surface: "面の背景色",
  ink: "本文の文字色",
  muted: "補助の文字色",
  borderColor: "境界線の色",
  success: "成功の色",
  warning: "警告の色",
  danger: "エラーの色",
  focus: "フォーカスの色",
  fontSize: "本文の文字サイズ (px)",
  fontFamily: "フォントの種類",
  heading1: "大見出しの文字サイズ (px)",
  heading2: "中見出しの文字サイズ (px)",
  heading3: "小見出しの文字サイズ (px)",
  lineHeight: "行の高さ (倍率)",
  bodyWeight: "本文の太さ",
  headingWeight: "見出しの太さ",
  spacing: "基本の余白 (px)",
  spacingScale: "余白の段階 (px)",
  pagePadding: "ページの余白 (px)",
  sectionGap: "セクション間の余白 (px)",
  controlHeight: "入力・ボタンの高さ (px)",
  rowHeight: "一覧行の高さ (px)",
  radius: "標準の角丸 (px)",
  radiusNone: "角丸なし (0px)",
  radiusXs: "最小の角丸 (px)",
  radiusSm: "小さな角丸 (px)",
  radiusLg: "大きな角丸 (px)",
  radiusPill: "丸いバッジの角丸 (px)",
  radiusUsage: "角丸の使い分け",
  border: "境界線を表示",
  borderWidth: "境界線の太さ (px)",
  borderPolicy: "境界線の使い方",
  shadow: "影を表示",
  shadowX: "影の横方向 (px)",
  shadowY: "影の縦方向 (px)",
  shadowBlur: "影のぼかし (px)",
  shadowSpread: "影の広がり (px)",
  shadowColor: "影の色",
  shadowOpacity: "影の不透明度 (0〜1)",
  shadowAllowed: "影を使える場所",
  duration: "動きの時間 (ms)",
  easing: "動きの速度変化",
  reducedMotion: "動きを減らす設定",
  compactBreakpoint: "小画面の境界 (px)",
  mediumBreakpoint: "中画面の境界 (px)",
  wideBreakpoint: "大画面の境界 (px)",
  compactPolicy: "小画面での配置",
  mediumPolicy: "中画面での配置",
  widePolicy: "大画面での配置",
};
export function FoundationEditor({
  design,
  tab,
  onChange,
  onTabChange,
  onValidityChange,
}: {
  design: Design;
  tab: string;
  onChange: (patch: Partial<Design>) => void;
  onTabChange: (tab: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    onValidityChange(Object.keys(errors).length === 0);
  }, [errors, onValidityChange]);
  const visibleFields: readonly string[] =
    fieldGroups[tab as keyof typeof fieldGroups];
  const hiddenErrors = Object.keys(errors).filter(
    (key) => !visibleFields.includes(key),
  );
  function edit(key: string, raw: string | boolean) {
    const old = design[key as keyof Design];
    const value =
      typeof old === "boolean"
        ? raw
        : typeof old === "number"
          ? raw === ""
            ? NaN
            : Number(raw)
          : Array.isArray(old)
            ? String(raw)
                .split(",")
                .map((n) => (n.trim() === "" ? NaN : Number(n)))
            : raw;
    const result = designSchema.safeParse({ ...design, [key]: value });
    if (!result.success) {
      setInputs((s) => ({ ...s, [key]: String(raw) }));
      setErrors((errors) => ({
        ...errors,
        [key]:
          typeof old === "number"
            ? "設定できる範囲の数値を入力してください。"
            : Array.isArray(old)
              ? "小さい順に、重複しない数値をカンマ区切りで入力してください。"
              : /^#[0-9a-fA-F]{6}$/.test(String(old))
                ? "#に続く6桁のカラーコードを入力してください（例: #536647）。"
                : "入力形式を確認してください。",
      }));
      onValidityChange(false);
      return;
    }
    const nextErrors = { ...errors };
    delete nextErrors[key];
    setErrors(nextErrors);
    setInputs((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    onValidityChange(Object.keys(nextErrors).length === 0);
    onChange({ [key]: value });
  }
  function decision(
    key: string,
    patch: Partial<z.infer<typeof decisionSchema>>,
  ) {
    onChange({
      constraints: {
        ...design.constraints,
        [key]: {
          ...emptyDecision,
          ...design.constraints[key],
          ...patch,
          author: "user",
        },
      },
    });
  }
  return (
    <div className="foundation-fields">
      <p className="muted">
        入力はPreviewへ仮反映されます。「変更を保存」で確定します。ロックはAIからの変更を禁止します。
      </p>
      {hiddenErrors.length > 0 && (
        <div className="editor-error" role="alert">
          <p>
            別のカテゴリーに入力エラーがあります。該当する欄を開いて修正してください。
          </p>
          {hiddenErrors.map((key) => {
            const category = Object.entries(fieldGroups).find(([, fields]) =>
              (fields as readonly string[]).includes(key),
            )![0];
            return (
              <button
                className="button small"
                key={key}
                onClick={() => onTabChange(category)}
              >
                {category}の{labels[key] || key}を修正
              </button>
            );
          })}
        </div>
      )}
      {fieldGroups[tab as keyof typeof fieldGroups].map((key) => {
        const value = design[key];
        const rule = design.constraints[key] ?? emptyDecision;
        const error = errors[key];
        const options =
          key === "fontFamily"
            ? ["sans-serif", "serif", "monospace"]
            : key === "easing"
              ? ["linear", "ease", "ease-in", "ease-out", "ease-in-out"]
              : key === "reducedMotion"
                ? ["none", "instant"]
                : null;
        return (
          <div className="foundation-field" key={key}>
            <label>
              <strong>
                {typeof value === "string" &&
                  /^#[0-9a-fA-F]{6}$/.test(value) && (
                    <span
                      className="token-swatch"
                      style={{ background: value }}
                    />
                  )}
                <span id={`field-${key}-label`}>{labels[key] || key}</span>{" "}
                <small>{key}</small>
              </strong>
              {typeof value === "boolean" ? (
                <input
                  aria-label={key}
                  aria-describedby={`field-${key}-label${error ? ` field-${key}-error` : ""}`}
                  aria-invalid={!!error}
                  type="checkbox"
                  checked={value}
                  onChange={(e) => edit(key, e.target.checked)}
                />
              ) : options ? (
                <select
                  aria-label={key}
                  aria-describedby={`field-${key}-label${error ? ` field-${key}-error` : ""}`}
                  aria-invalid={!!error}
                  value={String(value)}
                  onChange={(e) => edit(key, e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={key}
                  aria-describedby={`field-${key}-label${error ? ` field-${key}-error` : ""}`}
                  aria-invalid={!!error}
                  type={typeof value === "number" ? "number" : "text"}
                  step="any"
                  value={
                    inputs[key] ??
                    (Array.isArray(value) ? value.join(", ") : String(value))
                  }
                  onChange={(e) => edit(key, e.target.value)}
                />
              )}
            </label>
            {error && (
              <p id={`field-${key}-error`} role="alert" className="error-text">
                {error}
              </p>
            )}
            {key === "spacingScale" && (
              <small>px値を小さい順にカンマ区切りで入力</small>
            )}
            <label className="lock-field">
              <input
                type="checkbox"
                checked={rule.locked}
                onChange={(e) => decision(key, { locked: e.target.checked })}
              />{" "}
              {key}をAI変更からロック
            </label>
            <details>
              <summary>適用範囲・例外・決定理由・出典</summary>
              {(["scope", "exceptions", "rationale", "source"] as const).map(
                (field, i) => (
                  <label key={field}>
                    {["適用範囲", "例外", "決定理由", "出典"][i]}
                    <input
                      maxLength={1000}
                      aria-label={`${key} ${field}`}
                      value={rule[field]}
                      onChange={(e) =>
                        decision(key, { [field]: e.target.value })
                      }
                    />
                  </label>
                ),
              )}
            </details>
          </div>
        );
      })}
    </div>
  );
}
