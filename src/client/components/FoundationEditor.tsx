import { useEffect, useState } from "react";
import { designSchema, type Design } from "../../domain/design";
import {
  emptyDecision,
  fieldGroups,
  type decisionSchema,
} from "../../domain/foundation";
import type { z } from "zod";
export function FoundationEditor({
  design,
  tab,
  onChange,
  onValidityChange,
}: {
  design: Design;
  tab: string;
  onChange: (patch: Partial<Design>) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    setInputs({});
    setError("");
    onValidityChange(true);
  }, [tab, design, onValidityChange]);
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
      setError(result.error.issues[0].message);
      onValidityChange(false);
      return;
    }
    setError("");
    onValidityChange(true);
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
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {fieldGroups[tab as keyof typeof fieldGroups].map((key) => {
        const value = design[key];
        const rule = design.constraints[key] ?? emptyDecision;
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
                {key}
              </strong>
              {typeof value === "boolean" ? (
                <input
                  aria-label={key}
                  type="checkbox"
                  checked={value}
                  onChange={(e) => edit(key, e.target.checked)}
                />
              ) : options ? (
                <select
                  aria-label={key}
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
