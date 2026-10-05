import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  aspects,
  referenceInputSchema,
  type Job,
  type SavedReference,
  type ReferenceInput,
} from "../../domain/reference";
import { useStoredDraft, DraftReadRecovery } from "../draft-storage";
import { parseReferenceInputDraft } from "../draft-shapes";
import { useScope } from "../scope";
import type { Principle } from "../../domain/projects";
import { commitReferenceJob, type ReferenceData } from "../query-cache";
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function referenceRequest<T>(
  base: string,
  path = "",
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(base + path, {
    method,
    headers:
      body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.message || "入力内容を確認してください。",
    );
  return data;
}
function usableReference(value: unknown): value is SavedReference {
  if (!value || typeof value !== "object") return false;
  const r = value as SavedReference;
  return (
    referenceInputSchema.safeParse(value).success &&
    [r.name, r.url, r.likes, r.dislikes].every(
      (field) => typeof field === "string",
    ) &&
    (r.assetId === undefined || typeof r.assetId === "string") &&
    typeof r.id === "string" &&
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.id) &&
    Number.isInteger(r.version) &&
    r.version > 0 &&
    Array.isArray(r.accepted) &&
    r.accepted.every((index) => Number.isInteger(index) && index >= 0)
  );
}
type CreationCandidate = Pick<
  SavedReference,
  "id" | "version" | "name" | "url" | "likes" | "assetId"
>;
function usableCandidate(value: unknown): value is CreationCandidate {
  if (!value || typeof value !== "object") return false;
  const r = value as CreationCandidate;
  return (
    [r.name, r.url, r.likes].every((field) => typeof field === "string") &&
    typeof r.id === "string" &&
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.id) &&
    Number.isInteger(r.version) &&
    r.version > 0 &&
    (r.assetId === undefined || typeof r.assetId === "string")
  );
}
const defaults = (name: string, url = ""): ReferenceInput => ({
  name,
  url,
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
type ReferenceDraft = ReferenceInput & { baseVersion: number | null };
const referenceInput = (r: ReferenceInput): ReferenceInput => ({
  name: r.name,
  url: r.url,
  selections: r.selections,
  likes: r.likes,
  dislikes: r.dislikes,
});
const sameInput = (a: ReferenceInput, b: ReferenceInput) =>
  JSON.stringify(referenceInput(a)) === JSON.stringify(referenceInput(b));
const savedDraft = (r: SavedReference): ReferenceDraft => ({
  ...referenceInput(r),
  baseVersion: r.version,
});
function parseReferenceDraft(
  stored: unknown,
  r: SavedReference,
): ReferenceDraft {
  const input = parseReferenceInputDraft(stored);
  const version = Object.hasOwn(stored as object, "baseVersion")
    ? (stored as Record<string, unknown>).baseVersion
    : (stored as Record<string, unknown>).version;
  return {
    ...input,
    baseVersion:
      typeof version === "number" && Number.isInteger(version) && version > 0
        ? version
        : sameInput(input, r)
          ? r.version
          : null,
  };
}
type SaveJob = (path: string, body?: unknown) => Promise<Job>;
type SaveReference = (
  path: string,
  method: string,
  body: unknown,
) => Promise<SavedReference>;
export function References({
  onChange,
  onAdopt,
  onBusyChange,
}: {
  onChange: (references: SavedReference[]) => void;
  onAdopt?: (principle: Principle) => void;
  onBusyChange?: (busy: boolean, error?: string) => void;
}) {
  const scope = useScope(),
    base = `${scope.api}/references`;
  const request = <T,>(path = "", method = "GET", body?: unknown) =>
    referenceRequest<T>(base, path, method, body);
  const client = useQueryClient();
  const queryKey = ["references", scope.id];
  const saveJob: SaveJob = async (path, body) => {
    const job = await request<Job>(path, "POST", body);
    await commitReferenceJob(client, scope.id, job);
    return job;
  };
  const [unknownCreation, setUnknownCreation] = useState<{
    input: ReferenceInput;
    error: string;
  }>();
  const [creationCandidates, setCreationCandidates] =
    useState<CreationCandidate[]>();
  const [checkingCreation, setCheckingCreation] = useState(false);
  const [creationReadError, setCreationReadError] = useState("");
  const [allowSeparateCreation, setAllowSeparateCreation] = useState(false);
  const saveReference: SaveReference = async (path, method, body) => {
    const createsReference = path === "" && method === "POST";
    if (createsReference && unknownCreation)
      throw new Error("追加結果を確認してから別の追加を準備してください。");
    let saved: SavedReference;
    try {
      saved = await request<SavedReference>(path, method, body);
      // This endpoint creates a version-one input receipt, without derived metadata.
      if (
        createsReference &&
        (!usableReference(saved) ||
          saved.version !== 1 ||
          saved.accepted.length !== 0 ||
          ["assetId", "capture", "analysis", "analysisJobId"].some((key) =>
            Object.hasOwn(saved, key),
          ))
      )
        throw new Error("追加応答の参考を確認できません。");
    } catch (e) {
      // Current creation endpoint rejects validation, pairing/Origin and limits before writing.
      if (
        createsReference &&
        (!(e instanceof ApiError) ||
          ![400, 401, 403, 409, 413].includes(e.status))
      ) {
        setUnknownCreation({
          input: structuredClone(body as ReferenceInput),
          error: e instanceof Error ? e.message : "応答を取得できません。",
        });
        setCreationCandidates(undefined);
        setCreationReadError("");
        setAllowSeparateCreation(false);
      }
      throw e;
    }
    // Cancel older reads, and retain newer versions or an already known absence.
    await client.cancelQueries({ queryKey, exact: true });
    client.setQueryData<ReferenceData>(queryKey, (data) => {
      if (
        data &&
        !createsReference &&
        !data.references.some((r) => r.id === saved.id)
      )
        return data;
      return {
        references: data?.references.some((r) => r.id === saved.id)
          ? data.references.map((r) =>
              r.id === saved.id && r.version <= saved.version ? saved : r,
            )
          : [...(data?.references ?? []), saved],
        jobs: data?.jobs ?? [],
      };
    });
    return saved;
  };
  const removeReference = async (id: string) => {
    await client.cancelQueries({ queryKey, exact: true });
    client.setQueryData<ReferenceData>(queryKey, (data) =>
      data
        ? { ...data, references: data.references.filter((r) => r.id !== id) }
        : data,
    );
  };
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn: () => request<ReferenceData>(),
    retry: false,
    refetchInterval: (q) =>
      q.state.error
        ? false
        : typeof document !== "undefined" && document.hidden
          ? 10000
          : q.state.data?.jobs.some((j) =>
                ["running", "queued"].includes(j.state),
              )
            ? 1000
            : 5000,
  });
  useEffect(() => {
    if (query.data) onChange(query.data.references);
  }, [query.data]);
  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    onBusyChange?.(true);
    let failure: string | undefined;
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["references", scope.id] });
    } catch (e) {
      failure = e instanceof Error ? e.message : "処理に失敗しました。";
      setError(failure);
    } finally {
      setBusy(false);
      onBusyChange?.(false, failure);
    }
  }
  const needsPair =
    query.error instanceof ApiError && query.error.status === 401;
  if (needsPair)
    return (
      <section>
        <p role="alert">
          接続が切れています。起動ターミナルの接続コードを確認してください。
        </p>
        <button className="button" onClick={() => location.reload()}>
          接続画面を開く
        </button>
      </section>
    );
  return (
    <>
      <div className="intro-strip">
        <p>
          公開ページの初期表示を撮影して、好きな部分を集めましょう。
          <small>
            1440×1000で撮影します。取得できない場合は10MB以下のPNG・JPEG・WebP画像で続行できます。
          </small>
        </p>
      </div>
      <form
        className="reference-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || unknownCreation) return;
          void run(async () => {
            const parsed = new URL(url);
            const ref = await saveReference(
              "",
              "POST",
              defaults(parsed.hostname, parsed.href),
            );
            setUrl("");
            await saveJob(`/${ref.id}/jobs`, {
              version: ref.version,
              type: "capture",
              key: crypto.randomUUID(),
            });
          });
        }}
      >
        <input
          aria-label="Reference URL"
          type="url"
          disabled={busy}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          required
        />
        <button className="button primary" disabled={busy || !!unknownCreation}>
          参考を追加
        </button>
        <label className="button">
          画像を追加
          <input
            aria-label="画像を追加"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || !!unknownCreation}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (busy || unknownCreation) return;
              if (file)
                void run(async () => {
                  if (file.size > 10 * 1024 * 1024)
                    throw new Error("画像は10MB以下にしてください。");
                  const ref = await saveReference(
                    "",
                    "POST",
                    defaults(file.name),
                  );
                  const form = new FormData();
                  form.set("version", String(ref.version));
                  form.set("image", file);
                  await saveReference(`/${ref.id}/image`, "POST", form);
                });
            }}
          />
        </label>
      </form>
      {unknownCreation && (
        <section
          className="editor-error"
          aria-label="参考の追加結果を確認"
          style={{ overflowWrap: "anywhere" }}
        >
          <div role="alert">
            <p>
              追加結果を確認できません。サーバーで追加済みの可能性があるため、新規追加の通常再送を停止しています。
            </p>
            <p>{unknownCreation.error}</p>
          </div>
          <p>
            確認対象: {unknownCreation.input.url || unknownCreation.input.name}
          </p>
          <p>
            URLは編集できます。画像は別の追加を準備した後に選び直してください。ページ移動・再読み込み・別タブでは、この確認状態は引き継がれません。
          </p>
          <button
            type="button"
            className="button"
            disabled={busy || checkingCreation}
            onClick={async () => {
              setCheckingCreation(true);
              setCreationReadError("");
              setCreationCandidates(undefined);
              setAllowSeparateCreation(false);
              try {
                const all = await request<{ references: unknown }>();
                if (
                  !all ||
                  !Array.isArray(all.references) ||
                  !all.references.every(usableCandidate)
                )
                  throw new Error("候補一覧の内容を確認できません。");
                setCreationCandidates(
                  all.references.filter((r) =>
                    unknownCreation.input.url
                      ? r.url === unknownCreation.input.url
                      : r.name === unknownCreation.input.name.trim(),
                  ),
                );
              } catch (e) {
                setCreationReadError(
                  e instanceof Error ? e.message : "候補一覧を取得できません。",
                );
              } finally {
                setCheckingCreation(false);
              }
            }}
          >
            {checkingCreation ? "追加候補を確認中…" : "追加候補を確認"}
          </button>
          {creationReadError && (
            <p role="alert">
              候補を確認できませんでした。{creationReadError}{" "}
              新規追加の停止は維持しています。
            </p>
          )}
          {creationCandidates !== undefined && (
            <>
              <p>
                同じURLまたは画像名の候補: {creationCandidates.length}
                件。一致しても今回の追加結果とは限りません。候補がなくても、追加されなかったことを保証しません。
              </p>
              <ul>
                {creationCandidates.map((r) => (
                  <li key={r.id}>
                    {r.name} · ID {r.id} · v{r.version}
                    {r.assetId ? " · 画像あり" : ""}
                    {r.likes ? ` · ${r.likes}` : ""}
                  </li>
                ))}
              </ul>
              <label>
                <input
                  type="checkbox"
                  checked={allowSeparateCreation}
                  onChange={(e) => setAllowSeparateCreation(e.target.checked)}
                />
                重複する可能性を確認し、別の追加を準備する
              </label>
              <button
                type="button"
                className="button"
                disabled={!allowSeparateCreation || busy || checkingCreation}
                onClick={() => {
                  setUnknownCreation(undefined);
                  setCreationCandidates(undefined);
                  setAllowSeparateCreation(false);
                  setError("");
                }}
              >
                別の追加を準備
              </button>
            </>
          )}
        </section>
      )}
      {error && error !== unknownCreation?.error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {query.error && (
        <div role="alert" className="error-text">
          <p>
            参考一覧の読み込みに失敗しました。表示中の内容と入力は保持しています。
            {query.error.message}
          </p>
          <button
            className="button"
            disabled={busy || query.isFetching}
            onClick={() => void query.refetch()}
          >
            一覧を再取得
          </button>
        </div>
      )}
      {query.isPending && <p role="status">参考を読み込んでいます…</p>}
      <div className="reference-grid">
        {query.data?.references.map((ref) => (
          <ReferenceCard
            key={ref.id}
            reference={ref}
            onAdopt={onAdopt}
            saveReference={saveReference}
            saveJob={saveJob}
            removeReference={removeReference}
            jobs={query.data.jobs.filter((j) => j.referenceId === ref.id)}
            run={run}
            busy={busy}
            clearError={() => {
              setError("");
              onBusyChange?.(false);
            }}
          />
        ))}
      </div>
      {query.data?.references.length === 0 && (
        <p>URLまたは画像を追加してください。</p>
      )}
    </>
  );
}
function ReferenceCard({
  reference: r,
  onAdopt,
  saveReference,
  saveJob,
  removeReference,
  jobs,
  run,
  busy,
  clearError,
}: {
  reference: SavedReference;
  onAdopt?: (principle: Principle) => void;
  saveReference: SaveReference;
  saveJob: SaveJob;
  removeReference: (id: string) => Promise<void>;
  jobs: Job[];
  run: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  clearError: () => void;
}) {
  const scope = useScope(),
    base = `${scope.api}/references`;
  const request = <T,>(path = "", method = "GET", body?: unknown) =>
    referenceRequest<T>(base, path, method, body);
  const key = `tasteprint.${scope.id}.reference.${r.id}`;
  const [draft, setDraft, draftError, draftRecovery] =
    useStoredDraft<ReferenceDraft>(key, savedDraft(r), (stored) =>
      parseReferenceDraft(stored, r),
    );
  const [consent, setConsent] = useState(false);
  const previousSaved = useRef(r);
  useEffect(() => {
    const previous = previousSaved.current;
    setDraft((d) =>
      sameInput(d, r) ||
      (d.baseVersion === previous.version && sameInput(d, previous))
        ? savedDraft(r)
        : d,
    );
    previousSaved.current = r;
    setConsent(false);
  }, [r.version]);
  const job =
    [...jobs].reverse().find((j) => ["running", "queued"].includes(j.state)) ??
    jobs.at(-1);
  const active = jobs.some(
    (j) => j.state === "running" || j.state === "queued",
  );
  const updateBlocked = busy || draftRecovery.blocked;
  const dirty = !sameInput(draft, r);
  const stale = draft.baseVersion !== r.version;
  const start = (type: Job["type"]) =>
    run(() =>
      saveJob(`/${r.id}/jobs`, {
        type,
        version: r.version,
        key: crypto.randomUUID(),
        consent,
      }),
    );
  const states: Record<Job["state"], string> = {
    queued: "待機中",
    running: "処理中",
    succeeded: "完了",
    failed: "失敗",
    canceled: "中断済み",
    interrupted: "再起動により中断",
  };
  return (
    <article className="reference-card">
      {r.assetId && (
        <img
          className="reference-image"
          src={`${base}/${r.id}/image?v=${r.assetId}`}
          alt={`${r.name}の参考画像`}
        />
      )}
      <div className="reference-details">
        <DraftReadRecovery
          label={r.name}
          recovery={draftRecovery}
          disabled={busy || active}
        />
        {draftError && (
          <p role="alert" className="error-text">
            {draftError}
          </p>
        )}
        <h3>{r.name}</h3>
        <p>{r.url || "Uploaded image"}</p>
        {r.capture && (
          <details>
            <summary>取得情報・構造情報</summary>
            <p>
              取得日時: {r.capture.capturedAt}
              <br />
              最終URL: {r.capture.finalUrl}
              <br />
              画面: {r.capture.viewport.width}×{r.capture.viewport.height}
            </p>
            <pre>{JSON.stringify(r.capture.structure, null, 2)}</pre>
          </details>
        )}
        {job && (
          <div role="status">
            <p>
              {job.type === "capture" ? "URL取得" : "Codex分析"}:{" "}
              {states[job.state]}
            </p>
            {job.error && <p className="error-text">{job.error.message}</p>}
            {active && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(() => saveJob(`/jobs/${job.id}/cancel`))
                }
              >
                中断する
              </button>
            )}
          </div>
        )}
        {stale && (
          <div role="alert" className="error-text">
            <p>
              {draft.baseVersion === null
                ? "下書きの基準版を確認できません。"
                : "参考が別の操作で更新されています。"}
              入力は保持しています。最新の保存内容を読み込み、必要なメモを再入力してから保存してください。
            </p>
            <button
              className="button"
              disabled={updateBlocked || active}
              onClick={() => {
                setDraft(savedDraft(r));
                setConsent(false);
                clearError();
              }}
            >
              最新の保存内容を読み込む
            </button>
          </div>
        )}
        <fieldset disabled={updateBlocked || active}>
          <legend>参考内容</legend>
          <div className="foundation-field">
            <label>
              参考の名前
              <input
                type="text"
                value={draft.name}
                maxLength={200}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, name: e.target.value }));
                  setConsent(false);
                }}
              />
            </label>
            <label>
              参考URL
              <input
                type="url"
                value={draft.url}
                maxLength={2048}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, url: e.target.value }));
                  setConsent(false);
                }}
              />
            </label>
          </div>
          <p style={{ color: "inherit", fontSize: 12 }}>
            名前・URLも「観点・メモを保存」で確定します。保存すると、この参考の分析・採用状態を解除します。URLを変更すると画像・取得情報も外します。過去の設計履歴と確定済みの共通原則は保持します。
          </p>
          {aspects.map((aspect) => (
            <label className="reference-selection" key={aspect}>
              {aspect}
              <select
                aria-label={`${r.name} ${aspect}`}
                value={
                  draft.selections.find((s) => s.aspect === aspect)?.intent ||
                  "none"
                }
                onChange={(e) => {
                  const intent = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    selections: [
                      ...d.selections.filter((s) => s.aspect !== aspect),
                      ...(intent === "none"
                        ? []
                        : [
                            { aspect, intent: intent as "reference" | "avoid" },
                          ]),
                    ],
                  }));
                  setConsent(false);
                }}
              >
                <option value="none">選択しない</option>
                <option value="reference">参考にする</option>
                <option value="avoid">避ける</option>
              </select>
            </label>
          ))}
          <label>
            好きな点
            <textarea
              value={draft.likes}
              maxLength={2000}
              onChange={(e) => {
                setDraft((d) => ({ ...d, likes: e.target.value }));
                setConsent(false);
              }}
            />
          </label>
          <label>
            避けたい点
            <textarea
              value={draft.dislikes}
              maxLength={2000}
              onChange={(e) => {
                setDraft((d) => ({ ...d, dislikes: e.target.value }));
                setConsent(false);
              }}
            />
          </label>
          <button
            className="button"
            disabled={stale || !dirty || !draft.selections.length}
            onClick={() =>
              void run(async () => {
                const saved = await saveReference(`/${r.id}`, "PATCH", {
                  ...referenceInput(draft),
                  version: draft.baseVersion,
                });
                setDraft(savedDraft(saved));
              })
            }
          >
            観点・メモを保存
          </button>
        </fieldset>
        <div className="reference-actions">
          {r.url && (
            <button
              className="button"
              disabled={updateBlocked || active || dirty || stale}
              onClick={() => void start("capture")}
            >
              {job ? "URLを再取得" : "URLを取得"}
            </button>
          )}
          <label className="button">
            画像で続行
            <input
              aria-label={`${r.name}の画像をアップロード`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={updateBlocked || active || dirty || stale}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void run(() => {
                    const form = new FormData();
                    form.set("version", String(r.version));
                    form.set("image", file);
                    return saveReference(`/${r.id}/image`, "POST", form);
                  });
              }}
            />
          </label>
          <button
            className="button"
            disabled={updateBlocked || active}
            onClick={() =>
              void run(async () => {
                await request(`/${r.id}`, "DELETE", { version: r.version });
                await removeReference(r.id);
              })
            }
          >
            削除
          </button>
        </div>
        {r.assetId && (
          <section className="reference-analysis">
            <p>
              上の画像・取得情報・選択観点・メモをOpenAIに送信して分析します。
            </p>
            <label>
              <input
                type="checkbox"
                checked={consent}
                disabled={active || dirty || stale}
                onChange={(e) => setConsent(e.target.checked)}
              />
              送信対象を確認しました
            </label>
            <button
              className="button primary"
              disabled={updateBlocked || active || dirty || stale || !consent}
              onClick={() => void start("analyze")}
            >
              Codexで分析する
            </button>
          </section>
        )}
        {r.analysis?.findings.map((finding, i) => (
          <section className="reference-finding" key={i}>
            <h4>
              {finding.aspect} ·{" "}
              {finding.certainty === "insufficient"
                ? "判断材料不足"
                : finding.certainty}
            </h4>
            <dl>
              <dt>観察</dt>
              <dd>{finding.observation}</dd>
              <dt>解釈</dt>
              <dd>{finding.interpretation}</dd>
              <dt>推奨</dt>
              <dd>{finding.recommendation}</dd>
              <dt>根拠</dt>
              <dd>{finding.evidence}</dd>
            </dl>
            <button
              className="button"
              disabled={
                updateBlocked ||
                active ||
                dirty ||
                stale ||
                r.accepted.includes(i)
              }
              onClick={() =>
                void run(() =>
                  saveReference(`/${r.id}/accept`, "POST", {
                    version: r.version,
                    index: i,
                  }).then(() => {
                    onAdopt?.({
                      id: `reference:${r.id}:${i}`,
                      target: finding.aspect,
                      text: finding.recommendation,
                      reason: finding.interpretation,
                      sources: [r.url || r.name, finding.evidence],
                      locked: false,
                    });
                  }),
                )
              }
            >
              {r.accepted.includes(i) ? "採用済み" : "設計方針として採用"}
            </button>
          </section>
        ))}
      </div>
    </article>
  );
}
