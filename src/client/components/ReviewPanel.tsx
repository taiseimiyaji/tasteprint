import { useEffect, useRef, useState } from "react";
import type { Review } from "../../domain/review";
import {
  type Candidate,
  type Revision,
  foundationRequest as requestFoundation,
} from "../foundation-api";
import { PreviewFrame } from "./PreviewFrame";
import { Link, useScope } from "../scope";
type ReviewContext = {
  candidates: Candidate[];
  findingIds?: string[];
  selectedId?: string;
  reasons: Record<string, string>;
};
const emptyContext: ReviewContext = { candidates: [], reasons: {} };
const contextKey = (review: Review) => `${review.id}:${review.baseRevision}`;
const unresolvedFindings = (review: Review) =>
  review.findings.filter((f) => f.dismissal === undefined).map((f) => f.id);
function savedReviewContent(review: Review) {
  const { stateVersion: _version, stale: _stale, ...stored } = review;
  return JSON.stringify(stored);
}
function chooseReview(reply: Review, previous?: Review) {
  if (!Number.isSafeInteger(reply?.stateVersion) || reply.stateVersion < 0)
    throw new Error("レビュー結果の状態番号が不正です。再読込してください。");
  if (!previous) return { review: reply, accepted: true };
  if (reply.baseRevision !== previous.baseRevision)
    throw new Error(
      "同じレビューIDに異なる確定版があります。再読込してください。",
    );
  if (reply.stateVersion < previous.stateVersion)
    return { review: previous, accepted: false };
  if (
    reply.stateVersion === previous.stateVersion &&
    savedReviewContent(reply) !== savedReviewContent(previous)
  )
    throw new Error(
      "同じ状態番号のレビュー内容が一致しません。再読込してください。",
    );
  return {
    review: { ...reply, stale: previous.stale || reply.stale },
    accepted: true,
  };
}
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
  active,
  saved,
  applied,
  hasUnsavedDesign,
  onApplyingChange,
}: {
  active: boolean;
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
  const observedReviews = useRef<Review[]>([]);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(0);
  const [busy, setBusy] = useState(false);
  // This component lives with its project Workspace, even while not displayed.
  const [contexts, setContexts] = useState<Record<string, ReviewContext>>({});
  const observedFindings = useRef<Record<string, string[]>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const review = reviews[0];
  const key = review ? contextKey(review) : "";
  const context = contexts[key] ?? emptyContext;
  const reasons = context.reasons;
  const candidates = context.candidates.filter(
    (c) => c.baseRevision === review?.baseRevision,
  );
  const candidate = candidates.find((c) => c.id === context.selectedId);
  function updateReviews(update: (previous: Review[]) => Review[]) {
    // Async mutation handlers must see reads committed after their render.
    const next = update(observedReviews.current);
    observedReviews.current = next;
    setReviews(next);
  }
  function updateContext(
    key: string,
    update: (context: ReviewContext) => ReviewContext,
  ) {
    if (!mounted.current) return;
    setContexts((previous) => ({
      ...previous,
      [key]: update(previous[key] ?? emptyContext),
    }));
  }
  function reconcileContexts(data: Review[]) {
    for (const review of data)
      observedFindings.current[contextKey(review)] = unresolvedFindings(review);
    setContexts((previous) => {
      let next = previous;
      for (const r of data) {
        const k = contextKey(r),
          context = previous[k];
        if (!context) continue;
        const reasons = Object.fromEntries(
          Object.entries(context.reasons).filter(([id]) =>
            r.findings.some((f) => f.id === id && f.dismissal === undefined),
          ),
        );
        const findingIds = unresolvedFindings(r);
        const changedFindings =
          context.candidates.length > 0 &&
          JSON.stringify(context.findingIds) !== JSON.stringify(findingIds);
        if (
          changedFindings ||
          Object.keys(reasons).length !== Object.keys(context.reasons).length
        )
          next = {
            ...next,
            [k]: {
              ...context,
              reasons,
              ...(changedFindings
                ? {
                    candidates: [],
                    selectedId: undefined,
                    findingIds: undefined,
                  }
                : {}),
            },
          };
      }
      return next;
    });
  }
  const readVersion = useRef(0);
  function commitReview(savedReview: Review, select = false) {
    if (!mounted.current) return;
    let chosen: ReturnType<typeof chooseReview>;
    try {
      chosen = chooseReview(
        savedReview,
        observedReviews.current.find((r) => r.id === savedReview?.id),
      );
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "レビュー結果が不正です。");
      return;
    }
    if (!chosen.accepted) {
      if (select) {
        // A run may finish after a GET already observed a newer version of
        // that same Review. Honor its explicit selection using the known row.
        readVersion.current++;
        updateReviews((previous) => [
          chosen.review,
          ...previous.filter((r) => r.id !== chosen.review.id),
        ]);
      }
      return;
    }
    readVersion.current++;
    const merged = chosen.review;
    updateReviews((previous) =>
      select
        ? [merged, ...previous.filter((r) => r.id !== merged.id)]
        : previous.some((r) => r.id === merged.id)
          ? previous.map((r) => (r.id === merged.id ? merged : r))
          : [...previous, merged],
    );
    reconcileContexts([merged]);
    setReadError("");
  }
  async function refresh(preserveSelection = false) {
    if (!mounted.current) return;
    const version = ++readVersion.current;
    setReading((count) => count + 1);
    try {
      const data = await request<Review[]>();
      if (!mounted.current || version !== readVersion.current) return;
      if (!Array.isArray(data))
        throw new Error("レビュー一覧の形式が不正です。再読込してください。");
      const previous = observedReviews.current;
      const ids = new Set<string>();
      const accepted: Review[] = [];
      let rejected = false;
      const ordered = data.map((reply) => {
        if (ids.has(reply?.id))
          throw new Error(
            "レビュー一覧に重複したIDがあります。再読込してください。",
          );
        ids.add(reply.id);
        const chosen = chooseReview(
          reply,
          previous.find((r) => r.id === reply.id),
        );
        if (chosen.accepted) accepted.push(chosen.review);
        else rejected = true;
        return chosen.review;
      });
      // Reviews are never deleted. Preserve a newer locally known row missing
      // from an older list, while retaining the server's rowid order.
      const next = [...ordered, ...previous.filter((r) => !ids.has(r.id))];
      const selected =
        preserveSelection && next.find((r) => r.id === previous[0]?.id);
      const visible = selected
        ? [selected, ...next.filter((r) => r.id !== selected.id)]
        : next;
      updateReviews(() => visible);
      reconcileContexts(accepted);
      if (!rejected && (accepted.length > 0 || previous.length === 0))
        setReadError("");
    } catch (e) {
      if (mounted.current && version === readVersion.current)
        setReadError(e instanceof Error ? e.message : "結果を取得できません。");
    } finally {
      if (mounted.current) setReading((count) => count - 1);
    }
  }
  useEffect(() => {
    if (active) void refresh(true);
  }, [active, saved?.revision]);
  useEffect(() => {
    if (!active || reading) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, saved?.revision, reading]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const stale =
    review && (review.stale || review.baseRevision !== saved?.revision);
  if (!active) return null;
  return (
    <section className="review-results">
      <h2>実画面レビュー</h2>
      <p>
        保存済みrevisionのFoundation方針・ルール・設定と一覧／設定／フォームの画像を使用します。画像と設定をOpenAIへ送信します。未保存の編集・未確定のTaste回答は含みません。
      </p>
      <p>
        修正案の選択と未送信の見送り理由は、Inspiration〜Exportを移動しても保持します。概要・プロジェクト一覧・自分の好みへの移動、プロジェクト切替、再読込で解除されます。見送りを確定した結果の修正案は解除します。
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
          {!stale && unresolvedFindings(review).length > 0 && (
            <p>
              <a href="#review-proposal-action">修正案を作成する場所へ移動</a>
            </p>
          )}
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
                      disabled={busy}
                      value={reasons[f.id] || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        updateContext(key, (context) => ({
                          ...context,
                          reasons: {
                            ...context.reasons,
                            [f.id]: value,
                          },
                        }));
                      }}
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
            id="review-proposal-action"
            className="button"
            disabled={
              busy ||
              !!stale ||
              !review.findings.some((f) => f.dismissal === undefined)
            }
            onClick={() =>
              action(async () => {
                const findingIds = unresolvedFindings(review);
                const data = await request<{ candidates: Candidate[] }>(
                  `/${review.id}/proposals`,
                  {},
                );
                // A known dismissal cannot be undone by this older proposal reply.
                if (
                  JSON.stringify(observedFindings.current[key]) ===
                  JSON.stringify(findingIds)
                )
                  updateContext(key, (context) => ({
                    ...context,
                    candidates: data.candidates,
                    selectedId: undefined,
                    findingIds,
                  }));
                else if (mounted.current)
                  setError(
                    "指摘の状態が更新されたため、修正案を作成し直してください。",
                  );
                await refresh(true);
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
              aria-pressed={candidate?.id === c.id}
              onClick={() =>
                updateContext(key, (context) => ({
                  ...context,
                  selectedId: c.id,
                }))
              }
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
                      updateContext(key, (context) => ({
                        ...context,
                        candidates: [],
                        selectedId: undefined,
                        findingIds: undefined,
                      }));
                      await refresh();
                    } finally {
                      if (mounted.current) onApplyingChange(false);
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
              disabled={busy}
              onClick={() => {
                updateReviews((previous) => {
                  const selected = previous.find((v) => v.id === r.id) ?? r;
                  return [selected, ...previous.filter((v) => v.id !== r.id)];
                });
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
