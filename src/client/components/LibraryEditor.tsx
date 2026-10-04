import { useEffect, useState } from "react";
import type { Design } from "../../domain/design";
import {
  applicableStates,
  componentNames,
  type ComponentName,
  type PatternName,
} from "../../domain/library";
export function LibraryEditor({
  design,
  kind,
  name,
  onChange,
  onSelect,
  onValidityChange,
}: {
  design: Design;
  kind: "components" | "patterns";
  name: string;
  onChange: (patch: Partial<Design>) => void;
  onSelect: (name: string) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [invalidGaps, setInvalidGaps] = useState<Record<string, string>>({});
  const gapInput = invalidGaps[name];
  const gapError = Object.hasOwn(invalidGaps, name)
    ? "0〜96の整数を入力してください。"
    : "";
  useEffect(() => {
    onValidityChange?.(Object.keys(invalidGaps).length === 0);
  }, [invalidGaps, onValidityChange]);
  const config =
    kind === "components"
      ? design.components[name as ComponentName]
      : design.patterns[name as PatternName];
  const edit = (key: string, value: unknown) =>
    onChange({
      [kind]: { ...design[kind], [name]: { ...config, [key]: value } },
    });
  return (
    <section
      className="foundation-fields library-editor"
      aria-label={`${name} 設定`}
    >
      <h2>{name} 設定</h2>
      <p>
        変更は仮表示されます。「変更を保存」またはAI候補の採用で設計を確定します。Exportは確定版を使います。
      </p>
      {Object.keys(invalidGaps).some((entry) => entry !== name) && (
        <div className="editor-error" role="alert">
          <p>
            別のパターンに余白の入力エラーがあります。該当する欄を開いて修正してください。
          </p>
          {Object.keys(invalidGaps)
            .filter((entry) => entry !== name)
            .map((entry) => (
              <button
                className="button small"
                key={entry}
                onClick={() => onSelect(entry)}
              >
                {entry}の余白を修正
              </button>
            ))}
        </div>
      )}
      {"variant" in config ? (
        <>
          <label>
            見た目の種類（variant）
            <select
              aria-label="variant"
              aria-description="見た目の種類。塗りつぶし・枠線・控えめを選びます"
              value={config.variant}
              onChange={(e) => edit("variant", e.target.value)}
            >
              {["solid", "outline", "subtle"].map((v) => (
                <option key={v} value={v}>
                  {
                    (
                      {
                        solid: "塗りつぶし",
                        outline: "枠線",
                        subtle: "控えめ",
                        sm: "小",
                        md: "標準",
                        lg: "大",
                      } as Record<string, string>
                    )[v]
                  }
                </option>
              ))}
            </select>
          </label>
          <label>
            大きさ（size）
            <select
              aria-label="size"
              aria-description="大きさ。小・標準・大を選びます"
              value={config.size}
              onChange={(e) => edit("size", e.target.value)}
            >
              {["sm", "md", "lg"].map((v) => (
                <option key={v} value={v}>
                  {
                    (
                      {
                        solid: "塗りつぶし",
                        outline: "枠線",
                        subtle: "控えめ",
                        sm: "小",
                        md: "標準",
                        lg: "大",
                      } as Record<string, string>
                    )[v]
                  }
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>適用可能な状態</legend>
            <p>
              defaultは通常の表示で必須です。hoverはホバー、focusはフォーカス、disabledは無効、loadingは処理中、errorはエラー、emptyは空の表示です。
            </p>
            {applicableStates[name as ComponentName].map((state) => (
              <label key={state}>
                <input
                  type="checkbox"
                  checked={config.states.includes(state)}
                  disabled={state === "default"}
                  onChange={(e) =>
                    edit(
                      "states",
                      e.target.checked
                        ? [...config.states, state]
                        : config.states.filter((s) => s !== state),
                    )
                  }
                />
                {state}
              </label>
            ))}
          </fieldset>
        </>
      ) : (
        <>
          <label>
            余白 (px)
            <input
              aria-label="余白 (px)"
              type="number"
              min={0}
              max={96}
              value={gapInput ?? config.gap}
              aria-invalid={!!gapError}
              aria-describedby={gapError ? "pattern-gap-error" : undefined}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isInteger(n) && n >= 0 && n <= 96) {
                  setInvalidGaps((previous) => {
                    const next = { ...previous };
                    delete next[name];
                    return next;
                  });
                  edit("gap", n);
                } else {
                  setInvalidGaps((previous) => ({
                    ...previous,
                    [name]: e.target.value,
                  }));
                }
              }}
            />
          </label>
          {gapError && (
            <p id="pattern-gap-error" role="alert" className="error-text">
              {gapError}
            </p>
          )}
          <label>
            レスポンシブ動作
            <select
              aria-label="レスポンシブ動作"
              value={config.responsive}
              onChange={(e) => edit("responsive", e.target.value)}
            >
              <option value="stack">狭い画面で縦積み</option>
              <option value="wrap">狭い画面で折り返し</option>
            </select>
          </label>
          <div>
            構造（表示順）
            {config.structure.map((slot, i) => (
              <div key={slot}>
                {slot}{" "}
                <button
                  className="button small"
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...config.structure];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    edit("structure", next);
                  }}
                >
                  {slot}を上へ
                </button>
              </div>
            ))}
          </div>
          <fieldset>
            <legend>参照コンポーネント</legend>
            {componentNames.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  checked={config.components.includes(c)}
                  disabled={
                    config.components.length === 1 &&
                    config.components.includes(c)
                  }
                  onChange={(e) =>
                    edit(
                      "components",
                      e.target.checked
                        ? [...config.components, c]
                        : config.components.filter((v) => v !== c),
                    )
                  }
                />
                {c}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {(
        ["usage", "rationale", "variant" in config ? "rules" : "avoid"] as const
      ).map((key) => (
        <label key={key}>
          {
            {
              usage: "用途",
              rationale: "根拠",
              rules: "利用ルール",
              avoid: "避ける構成",
            }[key]
          }
          <textarea
            aria-label={
              {
                usage: "用途",
                rationale: "根拠",
                rules: "利用ルール",
                avoid: "避ける構成",
              }[key]
            }
            maxLength={1000}
            value={String(config[key as keyof typeof config] ?? "")}
            onChange={(e) => edit(key, e.target.value)}
          />
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={!!design.constraints[kind]?.locked}
          onChange={(e) =>
            onChange({
              constraints: {
                ...design.constraints,
                [kind]: e.target.checked
                  ? {
                      locked: true,
                      scope: "全画面",
                      exceptions: "",
                      rationale: "部品・構造の設定を保護",
                      source: "ユーザー指定",
                      author: "user",
                    }
                  : undefined,
              },
            })
          }
        />
        {kind}をAI変更からロック
      </label>
    </section>
  );
}
