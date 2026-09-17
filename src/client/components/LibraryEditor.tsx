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
}: {
  design: Design;
  kind: "components" | "patterns";
  name: string;
  onChange: (patch: Partial<Design>) => void;
}) {
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
      <p>変更は仮表示されます。保存または候補の採用でrevisionを確定します。</p>
      {"variant" in config ? (
        <>
          <label>
            variant
            <select
              aria-label="variant"
              value={config.variant}
              onChange={(e) => edit("variant", e.target.value)}
            >
              {["solid", "outline", "subtle"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            size
            <select
              aria-label="size"
              value={config.size}
              onChange={(e) => edit("size", e.target.value)}
            >
              {["sm", "md", "lg"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>適用可能な状態</legend>
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
              value={config.gap}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isInteger(n) && n >= 0 && n <= 96) edit("gap", n);
              }}
            />
          </label>
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
