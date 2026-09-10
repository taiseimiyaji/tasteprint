import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  aspects,
  type Job,
  type SavedReference,
  type ReferenceInput,
} from "../../domain/reference";
import { loadLegacyReferences } from "../state";
const base = "/api/references";
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(
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
const defaults = (name: string, url = ""): ReferenceInput => ({
  name,
  url,
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
export function References({
  onChange,
}: {
  onChange: (references: SavedReference[]) => void;
}) {
  const client = useQueryClient();
  const [legacy, setLegacy] = useState(loadLegacyReferences);
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["references"],
    queryFn: () => request<{ references: SavedReference[]; jobs: Job[] }>(),
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
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["references"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  const needsPair =
    query.error instanceof ApiError && query.error.status === 401;
  if (needsPair)
    return (
      <section className="reference-connect">
        <p>
          参考画像と分析結果をこのホストに保存します。起動ターミナルの接続コードを入力してください。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => request("/pair", "POST", { code }));
          }}
        >
          <label>
            接続コード{" "}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            接続する
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
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
      {legacy.length > 0 && (
        <section className="reference-connect">
          <p>
            以前このブラウザに保存した参考が{legacy.length}
            件あります。元の保存データを残したまま取り込めます。
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                for (const old of legacy) {
                  const selections = old.aspects
                    .filter((a): a is (typeof aspects)[number] =>
                      aspects.includes(a as (typeof aspects)[number]),
                    )
                    .map((aspect) => ({
                      aspect,
                      intent: "reference" as const,
                    }));
                  const created = await request<SavedReference>("", "POST", {
                    ...defaults(old.name, old.url),
                    ...(selections.length ? { selections } : {}),
                  });
                  try {
                    if (old.image) {
                      if (
                        !/^data:image\/(png|jpeg|webp);base64,/.test(old.image)
                      )
                        throw new Error("保存画像の形式を確認してください。");
                      const blob = await (await fetch(old.image)).blob();
                      const form = new FormData();
                      form.set("image", blob, "reference.png");
                      form.set("version", String(created.version));
                      await request(`/${created.id}/image`, "POST", form);
                    }
                  } catch (e) {
                    await request(`/${created.id}`, "DELETE", {
                      version: created.version,
                    });
                    throw e;
                  }
                  const imported: string[] = JSON.parse(
                    localStorage.getItem("tasteprint.references.imported") ||
                      "[]",
                  );
                  localStorage.setItem(
                    "tasteprint.references.imported",
                    JSON.stringify([...imported, old.id]),
                  );
                  setLegacy((list) => list.filter((r) => r.id !== old.id));
                }
              })
            }
          >
            以前の参考を取り込む
          </button>
        </section>
      )}
      <form
        className="reference-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const parsed = new URL(url);
            const ref = await request<SavedReference>(
              "",
              "POST",
              defaults(parsed.hostname, parsed.href),
            );
            setUrl("");
            await request(`/${ref.id}/jobs`, "POST", {
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
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          required
        />
        <button className="button primary" disabled={busy}>
          参考を追加
        </button>
        <label className="button">
          画像を追加
          <input
            aria-label="画像を追加"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void run(async () => {
                  if (file.size > 10 * 1024 * 1024)
                    throw new Error("画像は10MB以下にしてください。");
                  const ref = await request<SavedReference>(
                    "",
                    "POST",
                    defaults(file.name),
                  );
                  const form = new FormData();
                  form.set("version", String(ref.version));
                  form.set("image", file);
                  await request(`/${ref.id}/image`, "POST", form);
                });
            }}
          />
        </label>
      </form>
      {(error || query.error) && (
        <p role="alert" className="error-text">
          {error || query.error?.message}
        </p>
      )}
      {query.isPending && <p role="status">参考を読み込んでいます…</p>}
      <div className="reference-grid">
        {query.data?.references.map((ref) => (
          <ReferenceCard
            key={ref.id}
            reference={ref}
            jobs={query.data.jobs.filter((j) => j.referenceId === ref.id)}
            run={run}
            busy={busy}
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
  jobs,
  run,
  busy,
}: {
  reference: SavedReference;
  jobs: Job[];
  run: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<ReferenceInput>(r);
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    setDraft(r);
    setConsent(false);
  }, [r.version]);
  const job = jobs.at(-1);
  const active = jobs.some(
    (j) => j.state === "running" || j.state === "queued",
  );
  const dirty =
    JSON.stringify({
      name: draft.name,
      url: draft.url,
      selections: draft.selections,
      likes: draft.likes,
      dislikes: draft.dislikes,
    }) !==
    JSON.stringify({
      name: r.name,
      url: r.url,
      selections: r.selections,
      likes: r.likes,
      dislikes: r.dislikes,
    });
  const start = (type: Job["type"]) =>
    run(() =>
      request(`/${r.id}/jobs`, "POST", {
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
                  void run(() => request(`/jobs/${job.id}/cancel`, "POST"))
                }
              >
                中断する
              </button>
            )}
          </div>
        )}
        <fieldset disabled={busy || active}>
          <legend>参考にする観点</legend>
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
            disabled={!dirty || !draft.selections.length}
            onClick={() =>
              void run(() =>
                request(`/${r.id}`, "PATCH", { ...draft, version: r.version }),
              )
            }
          >
            観点・メモを保存
          </button>
        </fieldset>
        <div className="reference-actions">
          {r.url && (
            <button
              className="button"
              disabled={busy || active || dirty}
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
              disabled={busy || active || dirty}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void run(() => {
                    const form = new FormData();
                    form.set("version", String(r.version));
                    form.set("image", file);
                    return request(`/${r.id}/image`, "POST", form);
                  });
              }}
            />
          </label>
          <button
            className="button"
            disabled={busy || active}
            onClick={() =>
              void run(() =>
                request(`/${r.id}`, "DELETE", { version: r.version }),
              )
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
                disabled={active || dirty}
                onChange={(e) => setConsent(e.target.checked)}
              />
              送信対象を確認しました
            </label>
            <button
              className="button primary"
              disabled={busy || active || dirty || !consent}
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
              disabled={busy || active || dirty || r.accepted.includes(i)}
              onClick={() =>
                void run(() =>
                  request(`/${r.id}/accept`, "POST", {
                    version: r.version,
                    index: i,
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
