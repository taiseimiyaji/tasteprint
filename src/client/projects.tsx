import { useEffect, useState } from "react";
import { useRouterState, Link as RouterLink } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Workspace } from "./workspace";
import { References } from "./components/References";
import { ScopeContext, jsonRequest, useScope } from "./scope";
import {
  type Brief,
  type Principle,
  type TasteRevision,
  type TasteDiff,
  type ProjectSnapshot,
} from "../domain/projects";
import { profile, questions, type Choice } from "../domain/design";
import type { Project, ExportRecord } from "../server/projects/service";
import type { Revision } from "./foundation-api";
const req = jsonRequest;
function useAction() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    run: async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存に失敗しました");
      } finally {
        setBusy(false);
      }
    },
  };
}
function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? initial;
    } catch {
      return initial;
    }
  });
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      setError("");
    } catch {
      setError("下書きを保存できません。空き容量を確認してください。");
    }
  }, [key, value]);
  return [value, setValue, error] as const;
}
export function ProjectsApp() {
  const path = useRouterState({ select: (s) => s.location.pathname }),
    client = useQueryClient();
  const [code, setCode] = useState(""),
    [migrationReady, setMigrationReady] = useState(false);
  const action = useAction();
  const taste = useQuery({
    queryKey: ["profile"],
    queryFn: () =>
      req<{ current: TasteRevision; history: TasteRevision[] }>("/api/profile"),
    retry: false,
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => req<Project[]>("/api/projects"),
    enabled: !!taste.data,
  });
  useEffect(() => {
    if (!taste.data) return;
    let active = true;
    void action.run(async () => {
      const marker = "tasteprint.projects.migrated.v1";
      if (!localStorage.getItem(marker)) {
        const keys = [
          "tasteprint.workspace.v3",
          "tasteprint.workspace.v2",
          "tasteprint.mock.v1",
        ];
        const entries = keys.flatMap((key) => {
          const raw = localStorage.getItem(key);
          return raw ? [{ key, raw }] : [];
        });
        for (const e of entries)
          localStorage.setItem(`${e.key}.backup-before-projects`, e.raw);
        // The latest workspace is authoritative; older keys remain in the browser backup.
        if (entries.length)
          await req("/api/migration/browser", JSON.parse(entries[0].raw));
        localStorage.setItem(marker, "complete");
        await client.invalidateQueries({ queryKey: ["projects"] });
        await client.invalidateQueries({ queryKey: ["profile"] });
      }
      if (active) setMigrationReady(true);
    });
    return () => {
      active = false;
    };
  }, [!!taste.data]);
  if (!taste.data)
    return (
      <main className="projects-page">
        <h1>Tasteprint</h1>
        {(taste.error as { status?: number })?.status === 401 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await req("/api/pair", { code });
                await taste.refetch();
              });
            }}
          >
            <label>
              接続コード
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            <button className="button primary" disabled={action.busy}>
              接続する
            </button>
          </form>
        ) : (
          <>
            <p>{taste.error?.message || "読み込み中…"}</p>
            <button className="button" onClick={() => void taste.refetch()}>
              再試行
            </button>
          </>
        )}
        {action.error && <p role="alert">{action.error}</p>}
      </main>
    );
  if (!migrationReady)
    return (
      <main className="projects-page">
        <h1>保存データを確認しています</h1>
        <p role="alert">
          {action.error || "バックアップと移行が完了するまでお待ちください。"}
        </p>
        {action.error && (
          <button onClick={() => location.reload()}>再試行</button>
        )}
      </main>
    );
  const parts = path.split("/"),
    id = parts[1] === "projects" ? parts[2] : undefined;
  const scope = id
    ? {
        id,
        name:
          projects.data?.find((p) => p.id === id)?.brief.name || "プロジェクト",
        api: `/api/projects/${id}`,
        route: `/projects/${id}`,
      }
    : {
        id: "profile",
        name: "自分の好み",
        api: "/api/profile",
        route: "/profile",
      };
  return (
    <ScopeContext.Provider value={scope}>
      <div className="global-navigation">
        <RouterLink to={"/profile" as "/"}>自分の好み</RouterLink>
        <RouterLink to={"/projects" as "/"}>プロジェクト</RouterLink>
        <strong>{scope.name}</strong>
        <label>
          切り替え
          <select
            aria-label="プロジェクト切り替え"
            value={id || ""}
            onChange={(e) => {
              location.href = e.target.value
                ? `/projects/${e.target.value}/overview`
                : "/profile";
            }}
          >
            <option value="">自分の好み</option>
            {projects.data
              ?.filter((p) => !p.archivedAt || p.id === id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brief.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {id ? (
        <ProjectArea
          key={id}
          step={parts[3] || "overview"}
          taste={taste.data.current}
        />
      ) : parts[1] === "profile" ? (
        <ProfileEditor key="profile" current={taste.data.current} />
      ) : (
        <ProjectList
          taste={taste.data.current}
          projects={projects.data || []}
          error={projects.error?.message || ""}
        />
      )}
    </ScopeContext.Provider>
  );
}
function BriefFields({
  value,
  onChange,
}: {
  value: Brief;
  onChange: (b: Brief) => void;
}) {
  return (
    <div className="brief-fields">
      {(
        [
          ["name", "プロジェクト名"],
          ["purpose", "用途"],
          ["audience", "対象ユーザー"],
          ["desired", "目指す印象"],
          ["avoid", "避けたい印象"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            required={key === "name"}
            maxLength={key === "name" ? 100 : 2000}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
function ProjectList({
  taste,
  projects,
  error,
}: {
  taste: TasteRevision;
  projects: Project[];
  error: string;
}) {
  const [brief, setBrief, draftError] = useDraft("tasteprint.new-project", {
    name: "",
    purpose: "",
    audience: "",
    desired: "",
    avoid: "",
  });
  const [useTaste, setUseTaste] = useState(true);
  const action = useAction(),
    client = useQueryClient();
  return (
    <main className="projects-page">
      <h1>プロジェクト</h1>
      <p>同じ好みから、用途ごとに設計を育てる。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const p = await req<Project>("/api/projects", {
              brief,
              useTaste,
              sourceTasteProfileRevision: taste.revision,
            });
            localStorage.removeItem("tasteprint.new-project");
            location.href = `/projects/${p.id}/overview`;
          });
        }}
      >
        <h2>新規プロジェクト</h2>
        <BriefFields value={brief} onChange={setBrief} />
        <label>
          <input
            type="checkbox"
            checked={useTaste}
            onChange={(e) => setUseTaste(e.target.checked)}
          />
          共通の好みを使う
        </label>
        <p>
          共通 r{taste.revision} · {Object.keys(taste.snapshot.answers).length}{" "}
          回答 · {taste.snapshot.principles.length} 原則 ·{" "}
          {taste.snapshot.confirmed
            ? "確定済み"
            : "未確認（あとから入力できます）"}
        </p>
        <button
          className="button primary"
          disabled={action.busy || !brief.name.trim()}
        >
          プロジェクトを作成
        </button>
      </form>
      {[action.error, error, draftError].filter(Boolean).map((e) => (
        <p role="alert" key={e}>
          {e}
        </p>
      ))}
      <div className="project-list">
        {projects.map((p) => (
          <article key={p.id}>
            <h2>{p.brief.name}</h2>
            <p>{p.brief.purpose || "用途未設定"}</p>
            <p>
              {p.archivedAt ? "アーカイブ中" : "進行中"} · 確定 r
              {p.activeRevision} · 更新{" "}
              {new Date(p.updatedAt).toLocaleString("ja-JP")}
            </p>
            <RouterLink
              className="button"
              to={`/projects/${p.id}/overview` as "/"}
            >
              再開
            </RouterLink>
            {p.latestExport && (
              <RouterLink
                className="button"
                to={`/projects/${p.id}/export` as "/"}
              >
                最新Export r{p.latestExport.revision}
              </RouterLink>
            )}
            <button
              className="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await req(`/api/projects/${p.id}/archive`, {
                    baseRevision: p.activeRevision,
                    archived: !p.archivedAt,
                  });
                  await client.invalidateQueries({ queryKey: ["projects"] });
                })
              }
            >
              {p.archivedAt ? "アーカイブ解除" : "アーカイブ"}
            </button>
          </article>
        ))}
      </div>
    </main>
  );
}
function Principles({
  values,
  onChange,
}: {
  values: Principle[];
  onChange: (p: Principle[]) => void;
}) {
  return (
    <>
      <p>傾向・原則を記録します。具体的な色やpx値はFoundationで設定します。</p>
      {values.map((p, i) => (
        <fieldset className="principle-fields" key={p.id}>
          <legend>原則 {i + 1}</legend>
          {(
            [
              ["target", "対象（例: list / density / radius）"],
              ["text", "原則"],
              ["reason", "理由"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                maxLength={key === "target" ? 100 : 2000}
                value={p[key]}
                onChange={(e) =>
                  onChange(
                    values.map((v) =>
                      v.id === p.id ? { ...v, [key]: e.target.value } : v,
                    ),
                  )
                }
              />
            </label>
          ))}
          <label>
            必要な出典（1行に1件）
            <textarea
              value={p.sources.join("\n")}
              onChange={(e) =>
                onChange(
                  values.map((v) =>
                    v.id === p.id
                      ? {
                          ...v,
                          sources: e.target.value.split("\n").filter(Boolean),
                        }
                      : v,
                  ),
                )
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={p.locked}
              onChange={(e) =>
                onChange(
                  values.map((v) =>
                    v.id === p.id ? { ...v, locked: e.target.checked } : v,
                  ),
                )
              }
            />
            この原則をロック
          </label>
          <button
            className="button"
            type="button"
            onClick={() => onChange(values.filter((v) => v.id !== p.id))}
          >
            原則を削除
          </button>
        </fieldset>
      ))}
      <button
        className="button"
        type="button"
        onClick={() =>
          onChange([
            ...values,
            {
              id: crypto.randomUUID(),
              target: "list",
              text: "",
              reason: "",
              sources: [],
              locked: false,
            },
          ])
        }
      >
        原則を追加
      </button>
    </>
  );
}
function ProfileEditor({ current }: { current: TasteRevision }) {
  const [draft, setDraft, draftError] = useDraft("tasteprint.profile.draft", {
    baseProfileRevision: current.revision,
    ...current.snapshot,
  });
  const action = useAction(),
    client = useQueryClient();
  const [notice, setNotice] = useState("");
  return (
    <main className="projects-page">
      <h1>自分の好み</h1>
      <p>
        プロジェクトを作る前でも保存できます。更新は既存プロジェクトに自動反映されません。
      </p>
      <p>
        確定版 r{current.revision} ·{" "}
        {current.snapshot.confirmed ? "確認済み" : "未確認"}
      </p>
      {draft.baseProfileRevision !== current.revision && (
        <p role="alert">
          共通の好みが更新されています。下書きは保持しています。
          <button
            onClick={() =>
              setDraft({
                baseProfileRevision: current.revision,
                ...current.snapshot,
              })
            }
          >
            最新の確定版を読み込む
          </button>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const r = await req<TasteRevision>("/api/profile", draft);
            setDraft({ baseProfileRevision: r.revision, ...r.snapshot });
            await client.invalidateQueries({ queryKey: ["profile"] });
            setNotice("共通の好みを保存しました");
          });
        }}
      >
        <h2>Taste</h2>
        <p>比較セット taste-v1 · 未回答は推測しません。</p>
        {questions.map((q) => (
          <fieldset className="taste-question" key={q.id}>
            <legend>
              {q.title} · {q.context}
            </legend>
            <details>
              <summary>A/Bの画面を見比べる</summary>
              <div className="taste-options">
                {(["a", "b"] as const).map((choice, index) => (
                  <button
                    type="button"
                    className={`taste-card ${draft.answers[q.id] === choice ? "chosen" : ""}`}
                    key={choice}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        answers: { ...draft.answers, [q.id]: choice },
                      })
                    }
                  >
                    <div
                      className={`taste-example taste-${q.axis} option-${choice}`}
                    >
                      <div className="taste-example-title">{q.context}</div>
                      {[
                        "Website redesign",
                        "Brand guidelines",
                        "Customer portal",
                      ].map((name, i) => (
                        <div className="taste-example-row" key={name}>
                          <span className="taste-symbol">{i + 1}</span>
                          <span>
                            {name}
                            <small>Design team · Updated today</small>
                          </span>
                          <i />
                        </div>
                      ))}
                    </div>
                    <div className="taste-caption">
                      <span>{choice.toUpperCase()}</span>
                      <strong>{q.labels[index]}</strong>
                    </div>
                  </button>
                ))}
              </div>
            </details>
            <label>
              回答
              <select
                aria-label={q.id}
                value={draft.answers[q.id] || ""}
                onChange={(e) => {
                  const answers = { ...draft.answers };
                  if (e.target.value) answers[q.id] = e.target.value as Choice;
                  else delete answers[q.id];
                  setDraft({ ...draft, answers });
                }}
              >
                <option value="">未回答</option>
                {(
                  [
                    ["a", q.labels[0]],
                    ["b", q.labels[1]],
                    ["both", "両方"],
                    ["neither", "どちらでもない"],
                    ["skip", "スキップ"],
                  ] as const
                ).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              理由
              <input
                aria-label={`${q.id} 理由`}
                maxLength={2000}
                value={draft.reasons[q.id] || ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    reasons: { ...draft.reasons, [q.id]: e.target.value },
                  })
                }
              />
            </label>
          </fieldset>
        ))}
        <h2>Design DNA</h2>
        <pre>{JSON.stringify(profile(draft.answers), null, 2)}</pre>
        <p>
          回答から算出した傾向です。「共通の好みを保存」で確認・確定します。
        </p>
        <h2>採用する原則・根拠</h2>
        <Principles
          values={draft.principles}
          onChange={(principles) => setDraft({ ...draft, principles })}
        />
        <button className="button primary" disabled={action.busy}>
          共通の好みを保存
        </button>
      </form>
      {(action.error || draftError) && (
        <p role="alert">{action.error || draftError}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <h2>共通の参考</h2>
      <p>
        保存先:
        自分の好み。分析は明示的に採用した項目だけが原則候補になります。登録・削除後に「共通の好みを保存」で参考の版を確定してください。
      </p>
      <References
        onChange={() => {}}
        onAdopt={(p) =>
          setDraft((d) => ({
            ...d,
            principles: [...d.principles.filter((v) => v.id !== p.id), p],
          }))
        }
      />
    </main>
  );
}
function ProjectArea({ step, taste }: { step: string; taste: TasteRevision }) {
  const scope = useScope();
  const q = useQuery({
    queryKey: ["project", scope.id],
    queryFn: () =>
      req<{
        project: Project;
        current: Revision & { snapshot: ProjectSnapshot };
      }>(scope.api),
    staleTime: 0,
  });
  if (!q.data)
    return (
      <main className="projects-page">
        <h1>{q.error ? "プロジェクトを開けません" : "読み込み中…"}</h1>
        <p role="alert">{q.error?.message}</p>
        <button onClick={() => void q.refetch()}>再試行</button>
      </main>
    );
  const data = q.data;
  return (
    <>
      <div className="project-summary">
        <RouterLink to={`${scope.route}/overview` as "/"}>
          概要・設計方針
        </RouterLink>
        {data.project.archivedAt && (
          <span>アーカイブ中 · 変更するには一覧から解除してください</span>
        )}
        {taste.revision !==
          data.current.snapshot.sourceTasteProfileRevision && (
          <RouterLink to={`${scope.route}/overview` as "/"}>
            共通の好みに更新があります · 差分を確認
          </RouterLink>
        )}
      </div>
      {step === "overview" ? (
        <Overview
          key={scope.id}
          current={data.current}
          refresh={() => q.refetch()}
          taste={taste}
        />
      ) : (
        <Workspace
          key={scope.id}
          initial={data.current}
          projectName={data.project.brief.name}
        />
      )}
    </>
  );
}
function Overview({
  current,
  refresh,
  taste,
}: {
  current: Revision & { snapshot: ProjectSnapshot };
  refresh: () => Promise<unknown>;
  taste: TasteRevision;
}) {
  const scope = useScope(),
    client = useQueryClient(),
    action = useAction();
  const [draft, setDraft, error] = useDraft(`tasteprint.${scope.id}.overview`, {
    baseRevision: current.revision,
    brief: current.snapshot.brief,
    policies: current.snapshot.policies,
  });
  const [diff, setDiff] = useState<{
      baseRevision: number;
      baseProfileRevision: number;
      changes: TasteDiff[];
    }>(),
    [choices, setChoices] = useState<Record<string, "adopt" | "keep">>({}),
    [promote, setPromote] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (
      draft.baseRevision !== current.revision &&
      JSON.stringify(draft.brief) === JSON.stringify(current.snapshot.brief) &&
      JSON.stringify(draft.policies) ===
        JSON.stringify(current.snapshot.policies)
    )
      setDraft((d) => ({ ...d, baseRevision: current.revision }));
  }, [current.revision]);
  const sync = async () => {
    await refresh();
    await client.invalidateQueries({ queryKey: ["projects"] });
  };
  return (
    <main className="projects-page">
      <h1>{current.snapshot.brief.name}</h1>
      <p>概要・設計方針 · 確定 r{current.revision}</p>
      <nav className="project-steps">
        {[
          "foundation",
          "components",
          "patterns",
          "preview",
          "review",
          "export",
          "inspiration",
        ].map((s) => (
          <RouterLink
            className="button"
            key={s}
            to={`${scope.route}/${s}` as "/"}
          >
            {s}
          </RouterLink>
        ))}
      </nav>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const r = await req<Revision>(scope.api, draft);
            setDraft({ ...draft, baseRevision: r.revision });
            await sync();
          });
        }}
      >
        <BriefFields
          value={draft.brief}
          onChange={(brief) => setDraft({ ...draft, brief })}
        />
        <h2>このプロジェクト固有の方針・例外</h2>
        <Principles
          values={draft.policies}
          onChange={(policies) => setDraft({ ...draft, policies })}
        />
        <button className="button primary" disabled={action.busy}>
          概要・方針を保存
        </button>
        {draft.baseRevision !== current.revision && (
          <p role="alert">
            下書きの版が古くなっています。入力を確認してください。
            <button
              type="button"
              onClick={() =>
                setDraft({
                  baseRevision: current.revision,
                  brief: current.snapshot.brief,
                  policies: current.snapshot.policies,
                })
              }
            >
              確定内容に戻す
            </button>
          </p>
        )}
      </form>
      <h2>共通の好みから採用</h2>
      <p>
        参照版: {current.snapshot.sourceTasteProfileRevision ?? "なし"} ·{" "}
        {current.snapshot.taste.confirmed ? "確認済み" : "未確認"}
      </p>
      {current.snapshot.taste.principles.map((p) => (
        <p key={p.id}>
          {p.text} — {p.reason}
        </p>
      ))}
      <details>
        <summary>採用した回答・参考・根拠</summary>
        <pre>{JSON.stringify(current.snapshot.taste, null, 2)}</pre>
      </details>
      {current.snapshot.maintained.map((m) => (
        <p key={m.key}>
          固有の維持方針: {m.key} · {m.reason}
        </p>
      ))}
      <button
        className="button"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            const d = await req<NonNullable<typeof diff>>(
              `${scope.api}/taste-diff`,
            );
            setDiff(d);
            setChoices({});
          })
        }
      >
        差分を確認
      </button>
      {diff && (
        <section>
          <h3>共通 r{diff.baseProfileRevision} との差分</h3>
          {!diff.changes.length && <p>変更はありません。</p>}
          {diff.changes.map((d) => (
            <article className="taste-diff" key={d.key}>
              <h4>
                {d.kind} · {d.key}
              </h4>
              <pre>
                {JSON.stringify(d.before)} → {JSON.stringify(d.after)}
              </pre>
              {d.conflict && <p role="alert">競合: {d.conflict}</p>}
              <label>
                反映方法
                <select
                  aria-label={`差分 ${d.key}`}
                  value={choices[d.key] || ""}
                  onChange={(e) =>
                    setChoices({
                      ...choices,
                      [d.key]: e.target.value as "adopt" | "keep",
                    })
                  }
                >
                  <option value="">選択してください</option>
                  <option value="adopt" disabled={!!d.conflict}>
                    取り込み
                  </option>
                  <option value="keep">維持</option>
                </select>
              </label>
            </article>
          ))}
          <button
            className="button primary"
            disabled={action.busy || diff.changes.some((d) => !choices[d.key])}
            onClick={() =>
              void action.run(async () => {
                const r = await req<Revision>(`${scope.api}/taste-diff`, {
                  baseRevision: diff.baseRevision,
                  baseProfileRevision: diff.baseProfileRevision,
                  choices,
                });
                setDiff(undefined);
                await sync();
              })
            }
          >
            選択を確定して新revisionを作成
          </button>
        </section>
      )}
      <h2>共通の好みに追加</h2>
      <p>保存済みの原則・理由・出典だけを選んで追加します。</p>
      {current.snapshot.policies.map((p) => (
        <label className="promotion-choice" key={p.id}>
          <input
            type="checkbox"
            checked={promote.includes(p.id)}
            onChange={(e) => {
              setPromote(
                e.target.checked
                  ? [...promote, p.id]
                  : promote.filter((id) => id !== p.id),
              );
              setConfirmed(false);
            }}
          />
          {p.text} · 理由: {p.reason} · 出典: {p.sources.join(", ")}
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        選択した原則・理由・出典を共通へ追加することを確認しました
      </label>
      <button
        className="button"
        disabled={action.busy || !confirmed || !promote.length}
        onClick={() =>
          void action.run(async () => {
            await req(`${scope.api}/promote`, {
              baseRevision: current.revision,
              baseProfileRevision: taste.revision,
              ids: promote,
            });
            setPromote([]);
            setConfirmed(false);
            await client.invalidateQueries({ queryKey: ["profile"] });
          })
        }
      >
        選択した判断を共通に追加
      </button>
      {(action.error || error) && <p role="alert">{action.error || error}</p>}
    </main>
  );
}
export function ExportHistory({ revision }: { revision: number }) {
  const scope = useScope(),
    action = useAction();
  const query = useQuery({
    queryKey: ["exports", scope.id],
    queryFn: () => req<ExportRecord[]>(`${scope.api}/exports`),
  });
  const download = (r: ExportRecord, extension: string) => {
    const name = Object.keys(r.files).find((n) => n.endsWith(extension))!;
    const a = document.createElement("a");
    a.href = `${scope.api}/exports/${r.id}/${encodeURIComponent(name)}`;
    a.download = name;
    a.click();
  };
  return (
    <section>
      <p>
        このプロジェクトの確定 r{revision}{" "}
        を出力します。未保存の編集は含みません。
      </p>
      {[
        ["DESIGN.md", "DESIGN.md"],
        ["JSON", ".json"],
        ["CSS variables", ".css"],
      ].map(([label, ext]) => (
        <button
          key={label}
          className="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const r = await req<ExportRecord>(`${scope.api}/exports`, {
                baseRevision: revision,
              });
              download(r, ext);
              await query.refetch();
            })
          }
        >
          {label}
        </button>
      ))}
      {(action.error || query.error) && (
        <p role="alert">{action.error || query.error?.message}</p>
      )}
      <h2>Export履歴</h2>
      {query.data?.map((r) => (
        <article key={r.id}>
          <h3>
            r{r.revision} · 共通の好み r{r.sourceTasteProfileRevision ?? "なし"}
          </h3>
          <p>{r.createdAt}</p>
          {Object.keys(r.files).map((name) => (
            <a
              className="button"
              key={name}
              href={`${scope.api}/exports/${r.id}/${encodeURIComponent(name)}`}
              download={name}
            >
              {name}
            </a>
          ))}
        </article>
      ))}
    </section>
  );
}
