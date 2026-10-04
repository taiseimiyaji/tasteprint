import { useEffect, useRef, useState } from "react";
import type { Review } from "../../domain/review";
import {
  type Candidate,
  type Revision,
  foundationRequest as requestFoundation,
} from "../foundation-api";
import { PreviewFrame } from "./PreviewFrame";
import { Link, useScope } from "../scope";
async function reviewRequest<T>(
  base: string,
  path = "",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${base}/reviews${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "レビューに失敗しました。");
  return data;
}
export function ReviewPanel({
  saved,
  applied,
  hasUnsavedDesign,
  onApplyingChange,
}: {
  saved: Revision | null;
  applied: (r: Revision) => void | Promise<void>;
  hasUnsavedDesign: boolean;
  onApplyingChange: (applying: boolean) => void;
}) {
  const scope = useScope();
  const request = <T,>(path = "", body?: unknown) =>
    reviewRequest<T>(scope.api, path, body);
  const foundationRequest = <T,>(path: string, body?: unknown) =>
    requestFoundation<T>(path, body, `${scope.api}/foundation`);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidate, setCandidate] = useState<Candidate>();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const readVersion = useRef(0);
  function commitReview(savedReview: Review, select = false) {
    readVersion.current++;
    setReviews((previous) =>
      select
        ? [savedReview, ...previous.filter((r) => r.id !== savedReview.id)]
        : previous.some((r) => r.id === savedReview.id)
          ? previous.map((r) => (r.id === savedReview.id ? savedReview : r))
          : [...previous, savedReview],
    );
    setReadError("");
  }
  async function refresh(preserveSelection = false) {
    const version = readVersion.current;
    setReading((count) => count + 1);
    try {
      const data = await request<Review[]>();
      if (version !== readVersion.current) return;
      setReviews((previous) => {
        const selected =
          preserveSelection && data.find((r) => r.id === previous[0]?.id);
        return selected
          ? [selected, ...data.filter((r) => r.id !== selected.id)]
          : data;
      });
      setReadError("");
    } catch (e) {
      if (version === readVersion.current)
        setReadError(e instanceof Error ? e.message : "結果を取得できません。");
    } finally {
      setReading((count) => count - 1);
    }
  }
  useEffect(() => {
    void refresh();
  }, [saved?.revision]);
  useEffect(() => {
    if (reading) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [saved?.revision, reading]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  const review = reviews[0];
  const stale =
    review && (review.stale || review.baseRevision !== saved?.revision);
  return (
    <section className="review-results">
      <h2>実画面レビュー</h2>
      <p>
        保存済みrevisionのFoundation方針・ルール・設定と一覧／設定／フォームの画像を使用します。画像と設定をOpenAIへ送信します。未保存の編集・未確定のTaste回答は含みません。
      </p>
      {hasUnsavedDesign && (
        <p role="status">
          未保存の設計を保持しています。修正案を適用する前に、
          <Link to="/$step" params={{ step: "foundation" }}>
            Foundationで保存・取消を確認
          </Link>
          してください。
        </p>
      )}
      <button
        className="button primary"
        disabled={!saved || busy}
        onClick={() =>
          action(async () => {
            setCandidates([]);
            setCandidate(undefined);
            commitReview(
              await request<Review>("", { baseRevision: saved!.revision }),
              true,
            );
            await refresh(true);
          })
        }
      >
        {busy ? "処理中…" : "3画面を撮影してレビュー"}
      </button>
      {error && <p role="alert">{error}</p>}
      {readError && (
        <div>
          <p role="alert">
            レビュー結果を取得できませんでした。確定した設計と表示中の結果は保持しています。
            {readError}
          </p>
          <button
            className="button"
            disabled={busy || reading > 0}
            onClick={() => void refresh(true)}
          >
            {reading ? "結果を取得中…" : "結果を再取得"}
          </button>
        </div>
      )}
      {review && (
        <>
          <h3>
            revision {review.baseRevision} ·{" "}
            {stale ? "古い結果 · 再レビューしてください" : "確定revisionの結果"}
          </h3>
          <p>
            検証済みルール数: {review.verifiedRules.length} · 違反数:{" "}
            {review.findings.filter((f) => f.source === "machine").length} ·
            要判断の指摘数:{" "}
            {review.findings.filter((f) => f.source === "ai").length}
          </p>
          {review.status === "partial" && (
            <p role="alert">検証未完了: {review.error} 再実行してください。</p>
          )}
          <details open>
            <summary>検証範囲と未検証事項</summary>
            <ul>
              {review.scope.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary>入力画像・DNA・関連ルール</summary>
            <pre>{JSON.stringify(review.dna, null, 2)}</pre>
            {review.images.map((id, i) => (
              <a
                key={id}
                href={`${scope.api}/reviews/images/${id}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  style={{ width: "30%" }}
                  src={`${scope.api}/reviews/images/${id}`}
                  alt={["一覧", "設定", "フォーム"][i]}
                />
              </a>
            ))}
            <ul>
              {review.rules.map((r) => (
                <li id={`rule-${r.id}`} key={r.id}>
                  <strong>{r.id}</strong>: {r.description}
                </li>
              ))}
            </ul>
          </details>
          {review.findings.map((f) => (
            <article className="review-row" key={f.id}>
              <div>
                <h3>
                  {f.source === "machine" ? "機械検証" : "AIの解釈・要判断"} ·{" "}
                  {f.severity} · {f.targetPath}
                </h3>
                <a
                  href={`#rule-${f.ruleId}`}
                  onClick={() => {
                    const el = document
                      .getElementById(`rule-${f.ruleId}`)
                      ?.closest("details");
                    if (el) el.open = true;
                  }}
                >
                  {f.ruleId}
                </a>
                <p>{f.explanation}</p>
                <pre style={{ whiteSpace: "pre-wrap" }}>{f.evidence}</pre>
                <p>修正案: {f.suggestedChange}</p>
                {f.dismissal !== undefined ? (
                  <p>見送り済み: {f.dismissal || "理由なし"}</p>
                ) : (
                  <>
                    <input
                      aria-label={`見送り理由 ${f.id}`}
                      placeholder="見送り理由（任意）"
                      value={reasons[f.id] || ""}
                      onChange={(e) =>
                        setReasons({ ...reasons, [f.id]: e.target.value })
                      }
                    />
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          commitReview(
                            await request<Review>(`/${review.id}/dismiss`, {
                              baseRevision: saved!.revision,
                              findingId: f.id,
                              reason: reasons[f.id] || "",
                            }),
                          );
                          await refresh(true);
                        })
                      }
                    >
                      見送る
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          <button
            className="button"
            disabled={
              busy ||
              !!stale ||
              !review.findings.some((f) => f.dismissal === undefined)
            }
            onClick={() =>
              action(async () => {
                const data = await request<{ candidates: Candidate[] }>(
                  `/${review.id}/proposals`,
                  {},
                );
                setCandidates(data.candidates);
                setCandidate(undefined);
              })
            }
          >
            修正案を作成
          </button>
          {candidates.map((c) => (
            <button
              className="button"
              key={c.id}
              disabled={busy || !!stale}
              onClick={() => setCandidate(c)}
            >
              仮Preview: {c.explanation}
            </button>
          ))}
          {candidate && (
            <>
              <h3>仮Preview · 未適用</h3>
              <p>{candidate.explanation}</p>
              <pre>
                {Object.entries(candidate.design)
                  .filter(
                    ([key, value]) =>
                      JSON.stringify(value) !==
                      JSON.stringify(
                        review.design[key as keyof typeof review.design],
                      ),
                  )
                  .map(
                    ([key, value]) =>
                      `${key}: ${JSON.stringify(review.design[key as keyof typeof review.design])} → ${JSON.stringify(value)}`,
                  )
                  .join("\n")}
              </pre>
              {["list", "settings", "form"].map((screen) => (
                <PreviewFrame
                  key={screen}
                  design={candidate.design}
                  screen={screen}
                />
              ))}
              <button
                className="button primary"
                disabled={busy || !!stale || hasUnsavedDesign}
                onClick={() =>
                  action(async () => {
                    onApplyingChange(true);
                    try {
                      const revision = await foundationRequest<Revision>(
                        "/apply",
                        { id: candidate.id },
                      );
                      await applied(revision);
                      setCandidate(undefined);
                      setCandidates([]);
                      await refresh();
                    } finally {
                      onApplyingChange(false);
                    }
                  })
                }
              >
                まとめて適用
              </button>
            </>
          )}
        </>
      )}
      {reviews.length > 1 && (
        <details>
          <summary>過去のレビュー</summary>
          {reviews.slice(1).map((r) => (
            <button
              className="button"
              key={r.id}
              onClick={() => {
                setReviews([r, ...reviews.filter((v) => v.id !== r.id)]);
                setCandidates([]);
                setCandidate(undefined);
              }}
            >
              revision {r.baseRevision} · {r.createdAt}
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
