import { axes, questions, profile, type Choice } from "../../domain/design";
import type { TasteInput } from "../../domain/projects";
const axisNames = [
  "情報量",
  "角の仕上げ",
  "装飾",
  "コントラスト",
  "境界線",
  "影",
  "情報のまとまり",
];
export function TasteComparison({
  value,
  onChange,
  position,
  onPosition,
}: {
  value: TasteInput;
  onChange: (value: TasteInput) => void;
  position: number;
  onPosition: (position: number) => void;
}) {
  const index = Math.max(0, Math.min(questions.length - 1, position));
  const q = questions[index];
  const answered = questions.filter(
    (q) => value.answers[q.id] && value.answers[q.id] !== "skip",
  ).length;
  const skipped = questions.filter(
    (q) => value.answers[q.id] === "skip",
  ).length;
  const choose = (choice: Choice | "") => {
    const answers = { ...value.answers };
    if (choice) answers[q.id] = choice;
    else delete answers[q.id];
    onChange({ ...value, answers });
  };
  return (
    <section aria-label="好みの比較" className="taste-comparison">
      <div className="taste-question-navigation">
        <p role="status">
          {answered} 回答 · {skipped} スキップ ·{" "}
          {questions.length - answered - skipped} 未回答
        </p>
        <label>
          質問を選ぶ
          <select
            aria-label="質問を選ぶ"
            value={index}
            onChange={(e) => onPosition(Number(e.target.value))}
          >
            {questions.map((item, i) => (
              <option key={item.id} value={i}>
                {i + 1}. {axisNames[Math.floor(i / 2)]} — {item.context}{" "}
                {value.answers[item.id] === "skip"
                  ? "（スキップ）"
                  : value.answers[item.id]
                    ? "（回答済み）"
                    : "（未回答）"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <progress
        aria-label="質問の進捗"
        max={questions.length}
        value={answered + skipped}
      />
      <div className="taste-heading">
        <p>
          質問 {index + 1} / {questions.length} · {q.context}
        </p>
        <h2>{q.title}</h2>
        <p>同じ内容を見比べて、心地よい方を選んでください。</p>
      </div>
      <div className="taste-options">
        {(["a", "b"] as const).map((choice, i) => (
          <button
            type="button"
            key={choice}
            aria-label={`${choice.toUpperCase()}: ${q.labels[i]}`}
            aria-pressed={value.answers[q.id] === choice}
            className={`taste-card ${value.answers[q.id] === choice ? "chosen" : ""}`}
            onClick={() => choose(choice)}
          >
            <div
              className={`taste-example taste-${q.axis} option-${choice}`}
              aria-hidden="true"
            >
              <div className="taste-example-title">{q.context}</div>
              {["Webサイトの改善", "ブランドガイド", "顧客向けポータル"].map(
                (name, j) => (
                  <div className="taste-example-row" key={name}>
                    <span className="taste-symbol">{j + 1}</span>
                    <span>
                      {name}
                      <small>デザインチーム · 今日更新</small>
                    </span>
                    <i />
                  </div>
                ),
              )}
            </div>
            <div className="taste-caption">
              <span>{choice.toUpperCase()}</span>
              <strong>{q.labels[i]}</strong>
            </div>
          </button>
        ))}
      </div>
      <div className="taste-response">
        <label>
          回答
          <select
            aria-label={q.id}
            value={value.answers[q.id] || ""}
            onChange={(e) => choose(e.target.value as Choice | "")}
          >
            <option value="">未回答</option>
            <option value="a">{q.labels[0]}</option>
            <option value="b">{q.labels[1]}</option>
            <option value="both">両方</option>
            <option value="neither">どちらでもない</option>
            <option value="skip">スキップ</option>
          </select>
        </label>
        <label>
          理由（任意）
          <input
            aria-label={`${q.id} 理由`}
            maxLength={2000}
            value={value.reasons[q.id] || ""}
            onChange={(e) =>
              onChange({
                ...value,
                reasons: { ...value.reasons, [q.id]: e.target.value },
              })
            }
          />
        </label>
      </div>
      <div className="taste-pagination">
        <button
          className="button"
          type="button"
          disabled={index === 0}
          onClick={() => onPosition(index - 1)}
        >
          前の質問
        </button>
        <button
          className="button"
          type="button"
          onClick={() => {
            choose("skip");
            onPosition(Math.min(index + 1, questions.length - 1));
          }}
        >
          スキップして次へ
        </button>
        <button
          className="button"
          type="button"
          disabled={index === questions.length - 1}
          onClick={() => onPosition(index + 1)}
        >
          次の質問
        </button>
      </div>
      {answered + skipped === questions.length && (
        <p role="status">
          ひと通り確認しました。回答はいつでも見直せます。「DNA・原則」で傾向を確認して保存してください。
        </p>
      )}
    </section>
  );
}
export function TasteSummary({ value }: { value: TasteInput }) {
  const dna = profile(value.answers);
  return (
    <section aria-label="好みの傾向">
      <h2>Design DNA</h2>
      <p>
        回答から見えてきた傾向です。用途による違いは原則と理由に残しましょう。
      </p>
      <div className="dna-summary">
        {axes.map((axis, i) => {
          const related = questions.filter((q) => q.axis === axis);
          const effective = related.filter((q) =>
            ["a", "b", "both"].includes(value.answers[q.id]),
          );
          const score = dna[axis];
          return (
            <article key={axis}>
              <h3>{axisNames[i]}</h3>
              <p>
                {score === null
                  ? "未確認・判断材料がありません"
                  : score < 0.4
                    ? related[0].labels[0]
                    : score > 0.6
                      ? related[0].labels[1]
                      : "両方のよさがあります・用途に合わせて選ぶ"}
              </p>
              <small>傾向に使った回答 {effective.length} / 2</small>
              {related.map(
                (q) =>
                  value.reasons[q.id] && (
                    <p className="dna-reason" key={q.id}>
                      {q.context}: {value.reasons[q.id]}
                    </p>
                  ),
              )}
            </article>
          );
        })}
      </div>
      <details>
        <summary>データの詳細（JSON）</summary>
        <pre>{JSON.stringify(dna, null, 2)}</pre>
      </details>
    </section>
  );
}
