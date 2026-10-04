import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBlocker,
  useRouterState,
  Link as RouterLink,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Workspace } from "./workspace";
import { AppShell } from "./navigation";
import { EditorActions } from "./components/EditorActions";
import { TasteComparison, TasteSummary } from "./components/TasteComparison";
import { References } from "./components/References";
import { ScopeContext, jsonRequest, useScope } from "./scope";
import {
  type Brief,
  type Principle,
  type TasteRevision,
  type TasteInput,
  type TasteDiff,
  type ProjectSnapshot,
} from "../domain/projects";
import { profile, questions, type Choice } from "../domain/design";
import type { Project, ExportRecord } from "../server/projects/service";
import type { Revision } from "./foundation-api";
import {
  beginProjectStatusWrite,
  commitExport,
  commitProfile,
  commitProject,
  commitProjectRevision,
  type ProjectData,
} from "./query-cache";
import { useStoredDraft as useDraft, DraftReadRecovery } from "./draft-storage";
import {
  parseBriefDraft,
  parseProfileDraft,
  parseOverviewDraft,
  parsePositionDraft,
  parseUseTasteDraft,
} from "./draft-shapes";
const req = jsonRequest;
function useAction() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    clear: () => setError(""),
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
      <AppShell path={path} ready={false}>
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
      </AppShell>
    );
  if (!migrationReady)
    return (
      <AppShell path={path} ready={false}>
        <main className="projects-page">
          <h1>保存データを確認しています</h1>
          <p role="alert">
            {action.error || "バックアップと移行が完了するまでお待ちください。"}
          </p>
          {action.error && (
            <button onClick={() => location.reload()}>再試行</button>
          )}
        </main>
      </AppShell>
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
      <AppShell path={path} projects={projects.data}>
        {taste.error && (
          <div className="project-summary">
            <p role="alert">
              共通の好みを取得できませんでした。表示中の確定版と入力は保持しています。
              {taste.error.message}
            </p>
            <button
              className="button"
              disabled={taste.isFetching}
              onClick={() => void taste.refetch()}
            >
              共通の好みを再取得
            </button>
          </div>
        )}
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
            loading={projects.isPending || projects.isFetching}
            onRetry={() => void projects.refetch()}
          />
        )}
      </AppShell>
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
  loading,
  onRetry,
}: {
  taste: TasteRevision;
  projects: Project[];
  error: string;
  loading: boolean;
  onRetry: () => void;
}) {
  const [brief, setBrief, draftError, briefRecovery] = useDraft<Brief>(
    "tasteprint.new-project",
    { name: "", purpose: "", audience: "", desired: "", avoid: "" },
    parseBriefDraft,
  );
  const [useTaste, setUseTaste, tasteDraftError, tasteRecovery] = useDraft(
    "tasteprint.new-project.use-taste",
    true,
    parseUseTasteDraft,
  );
  const [archived, setArchived] = useState(false),
    [search, setSearch] = useState(""),
    [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const action = useAction(),
    client = useQueryClient();
  const visible = projects
    .filter(
      (p) =>
        !!p.archivedAt === archived &&
        `${p.brief.name} ${p.brief.purpose}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <main className="projects-page">
      <div className="eyebrow">YOUR PROJECTS</div>
      <div className="project-list-heading">
        <div>
          <h1>
            プロジェクト<span className="brand-dot">.</span>
          </h1>
          <p>同じ好みから、用途ごとに設計を育てる。</p>
        </div>
        <button
          className="button primary"
          onClick={() => dialog.current?.showModal()}
        >
          新規プロジェクト
        </button>
      </div>
      <div className="project-list-tools">
        <nav className="section-navigation" aria-label="プロジェクトの表示">
          <button
            className="button"
            aria-pressed={!archived}
            onClick={() => setArchived(false)}
          >
            進行中 ({projects.filter((p) => !p.archivedAt).length})
          </button>
          <button
            className="button"
            aria-pressed={archived}
            onClick={() => setArchived(true)}
          >
            アーカイブ ({projects.filter((p) => p.archivedAt).length})
          </button>
        </nav>
        <label>
          プロジェクトを検索
          <input
            type="search"
            placeholder="名前・用途で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <p role="status" aria-live="polite">
        {notice ||
          (loading
            ? "プロジェクトを読み込み中…"
            : `${archived ? "アーカイブ" : "進行中"} · ${visible.length} 件 · 更新が新しい順`)}
      </p>
      {error && (
        <div role="alert">
          <p>一覧を読み込めませんでした。{error}</p>
          <button className="button" onClick={onRetry} disabled={loading}>
            一覧を再読み込み
          </button>
        </div>
      )}
      {action.error && !dialog.current?.open && (
        <p role="alert">
          {action.error}。一覧を再読み込みして再試行してください。
          <button className="button" onClick={onRetry}>
            一覧を再読み込み
          </button>
        </p>
      )}
      {!loading && !error && visible.length === 0 && (
        <div className="project-empty">
          <h2>
            {search.trim()
              ? "検索条件に一致するプロジェクトがありません"
              : projects.length === 0
                ? "最初のプロジェクトを作りましょう"
                : archived
                  ? "アーカイブはありません"
                  : "進行中のプロジェクトはありません"}
          </h2>
          {search.trim() ? (
            <button className="button" onClick={() => setSearch("")}>
              検索をクリア
            </button>
          ) : (
            <>
              <p>
                名前だけで始められます。好みや詳しい用途はあとから入力できます。
              </p>
              <RouterLink className="button" to={"/profile" as "/"}>
                共通の好みを編集
              </RouterLink>
              {!archived && projects.length > 0 && (
                <button className="button" onClick={() => setArchived(true)}>
                  アーカイブを見る
                </button>
              )}
            </>
          )}
        </div>
      )}
      <div
        className="project-list project-rows"
        aria-label={archived ? "アーカイブ一覧" : "進行中の一覧"}
        aria-busy={loading}
      >
        {visible.map((p) => (
          <article key={p.id}>
            <div className="project-row-title">
              <h2>{p.brief.name}</h2>
              <p>{p.brief.purpose || "用途未設定"}</p>
              <p className="project-meta">
                {p.archivedAt ? "アーカイブ中" : "進行中"} · 設計 r
                {p.activeRevision} · 更新{" "}
                {new Date(p.updatedAt).toLocaleString("ja-JP")}
              </p>
            </div>
            <div className="project-row-export">
              {p.latestExport ? (
                <RouterLink to={`/projects/${p.id}/export` as "/"}>
                  最新Export r{p.latestExport.revision}
                </RouterLink>
              ) : (
                <span>まだ出力していません</span>
              )}
            </div>
            <div className="project-row-actions">
              <RouterLink
                className="button primary"
                to={`/projects/${p.id}/overview` as "/"}
              >
                再開
              </RouterLink>
              <button
                className="button"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const isCurrent = beginProjectStatusWrite(client, p.id);
                    const saved = await req<Project>(
                      `/api/projects/${p.id}/archive`,
                      {
                        baseRevision: p.activeRevision,
                        archived: !p.archivedAt,
                      },
                    );
                    await commitProject(client, saved, isCurrent);
                    await client.invalidateQueries({
                      queryKey: ["project", p.id],
                      exact: true,
                    });
                    await client.invalidateQueries({ queryKey: ["projects"] });
                    setNotice(
                      `${p.brief.name}を${p.archivedAt ? "進行中に戻しました" : "アーカイブしました"}。${p.archivedAt ? "進行中" : "アーカイブ"}タブから確認できます。`,
                    );
                  })
                }
              >
                {p.archivedAt ? "アーカイブ解除" : "アーカイブ"}
              </button>
            </div>
          </article>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="project-create-dialog"
        aria-labelledby="create-project-title"
        onCancel={(e) => {
          if (action.busy) e.preventDefault();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const p = await req<Project>("/api/projects", {
                brief,
                useTaste,
                sourceTasteProfileRevision: taste.revision,
              });
              // The project is committed. Optional browser cleanup must not
              // report creation as failed or offer another creation attempt.
              for (const key of [
                "tasteprint.new-project",
                "tasteprint.new-project.use-taste",
              ]) {
                try {
                  localStorage.removeItem(key);
                } catch {}
              }
              location.href = `/projects/${p.id}/overview`;
            });
          }}
        >
          <h2 id="create-project-title">新規プロジェクト</h2>
          <p>名前だけで作成できます。閉じても入力は下書きとして残ります。</p>
          <DraftReadRecovery
            label="新規プロジェクト"
            recovery={briefRecovery}
            disabled={action.busy}
          />
          <DraftReadRecovery
            label="共通の好みの使用"
            recovery={tasteRecovery}
            disabled={action.busy}
          />
          <fieldset
            disabled={
              action.busy || briefRecovery.blocked || tasteRecovery.blocked
            }
          >
            <label>
              プロジェクト名
              <input
                autoFocus
                required
                maxLength={100}
                value={brief.name}
                onChange={(e) => setBrief({ ...brief, name: e.target.value })}
              />
            </label>
            <details>
              <summary>用途などを追加（任意）</summary>
              <div className="brief-fields">
                {(
                  [
                    ["purpose", "用途"],
                    ["audience", "対象ユーザー"],
                    ["desired", "目指す印象"],
                    ["avoid", "避けたい印象"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      maxLength={2000}
                      value={brief[key]}
                      onChange={(e) =>
                        setBrief({ ...brief, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <label>
              <input
                type="checkbox"
                checked={useTaste}
                onChange={(e) => setUseTaste(e.target.checked)}
              />
              共通の好みを使う
            </label>
            <p>
              共通 r{taste.revision} ·{" "}
              {taste.snapshot.confirmed
                ? "確定済み"
                : "未確認（あとから入力できます）"}
            </p>
          </fieldset>
          {[action.error, draftError, tasteDraftError]
            .filter(Boolean)
            .map((e) => (
              <p role="alert" key={e}>
                {e}。入力は保持しています。
              </p>
            ))}
          <div className="project-create-actions">
            <button
              type="button"
              className="button"
              disabled={action.busy}
              onClick={() => dialog.current?.close()}
            >
              閉じる
            </button>
            <button
              className="button primary"
              disabled={
                action.busy ||
                briefRecovery.blocked ||
                tasteRecovery.blocked ||
                !brief.name.trim()
              }
            >
              {action.busy ? "作成中…" : "プロジェクトを作成"}
            </button>
          </div>
        </form>
      </dialog>
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
  const [draft, setDraft, draftError, draftRecovery] = useDraft<
    TasteInput & { baseProfileRevision: number }
  >(
    "tasteprint.profile.draft",
    {
      baseProfileRevision: current.revision,
      ...current.snapshot,
    },
    parseProfileDraft,
  );
  const [position, setPosition, positionError, positionRecovery] = useDraft(
    "tasteprint.profile.position",
    0,
    parsePositionDraft,
  );
  const [section, setSection] = useState("taste");
  const [referencesBusy, setReferencesBusy] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [references, setReferences] = useState<
    { id: string; version: number; accepted: number[] }[] | null
  >(null);
  const signature = (items: unknown[]) =>
    JSON.stringify(
      items
        .map((item) => {
          const r = item as { id: string; version: number; accepted: number[] };
          return [r.id, r.version, r.accepted.length];
        })
        .sort(),
    );
  const dirty =
    !current.snapshot.confirmed ||
    JSON.stringify([draft.answers, draft.reasons, draft.principles]) !==
      JSON.stringify([
        current.snapshot.answers,
        current.snapshot.reasons,
        current.snapshot.principles,
      ]) ||
    (references !== null &&
      signature(references) !== signature(current.snapshot.references));
  const stale = draft.baseProfileRevision !== current.revision;
  const action = useAction(),
    client = useQueryClient();
  const [notice, setNotice] = useState("");
  const [navigationNotice, setNavigationNotice] = useState("");
  const pending = action.busy || referencesBusy;
  const unread = draftRecovery.blocked || positionRecovery.blocked;
  const updateError =
    action.error || referenceError || draftError || positionError;
  const shouldWaitForUpdate = useCallback(() => pending, [pending]);
  const navigation = useBlocker({
    shouldBlockFn: shouldWaitForUpdate,
    withResolver: true,
    enableBeforeUnload: pending,
  });
  useEffect(() => {
    if (pending) setNavigationNotice("");
    else if (navigation.status === "blocked") {
      if (updateError) {
        setNavigationNotice(
          "更新または下書きの保存に失敗したため、移動を中止しました。入力はこの画面に保持しています。",
        );
        navigation.reset();
      } else navigation.proceed();
    }
  }, [pending, navigation, updateError]);
  const reset = () => {
    action.clear();
    setDraft({ baseProfileRevision: current.revision, ...current.snapshot });
  };
  return (
    <main className="projects-page profile-page">
      <div className="eyebrow">YOUR DESIGN LANGUAGE</div>
      <h1>
        自分の好み<span className="brand-dot">.</span>
      </h1>
      <p>
        見比べて「好き」を集める。保存した好みを、プロジェクトごとの設計に使えます。
      </p>
      <EditorActions
        scope="すべてのプロジェクトで使う好み"
        target="共通の好み"
        revision={current.revision}
        dirty={dirty}
        stale={stale}
        busy={action.busy}
        error={action.error || draftError || positionError}
        notice={notice}
      >
        <button
          className="button"
          type="button"
          disabled={action.busy || unread || (!dirty && !stale)}
          onClick={reset}
        >
          {stale ? "最新の確定版を読み込む" : "未保存の変更を取り消す"}
        </button>
        <button
          className="button primary"
          form="profile-form"
          disabled={action.busy || referencesBusy || unread || stale}
        >
          共通の好みを保存
        </button>
        {navigation.status === "blocked" && (
          <p className="editor-error" role="status">
            更新の完了を待ってから移動します。採用した原則と編集中の内容を下書きに残しています。
          </p>
        )}
        {navigationNotice && (
          <p className="editor-error" role="alert">
            {navigationNotice}
          </p>
        )}
      </EditorActions>
      {stale && (
        <p role="alert">
          共通の好みが更新されています。下書きは保持しています。最新の確定版を読み込むと、この下書きを置き換えます。
        </p>
      )}
      <DraftReadRecovery
        label="共通の好み"
        recovery={draftRecovery}
        disabled={pending}
      />
      <DraftReadRecovery
        label="比較位置"
        recovery={positionRecovery}
        disabled={pending}
      />
      <nav className="section-navigation" aria-label="好みの編集項目">
        {[
          ["taste", "見比べる"],
          ["dna", "DNA・原則"],
          ["references", "参考を集める"],
        ].map(([key, label]) => (
          <button
            key={key}
            className="button"
            type="button"
            aria-pressed={section === key}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <form
        id="profile-form"
        className="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const r = await req<TasteRevision>("/api/profile", draft).catch(
              (e) => {
                if (e.status === 409)
                  void client.invalidateQueries({ queryKey: ["profile"] });
                throw e;
              },
            );
            setDraft({ baseProfileRevision: r.revision, ...r.snapshot });
            await commitProfile(client, r);
            await client.invalidateQueries({ queryKey: ["profile"] });
            setNotice("共通の好みを保存しました");
          });
        }}
      >
        <fieldset className="editor-fieldset" disabled={action.busy || unread}>
          <div hidden={section !== "taste"}>
            <TasteComparison
              value={draft}
              onChange={(value) => setDraft({ ...draft, ...value })}
              position={position}
              onPosition={setPosition}
            />
          </div>
          <div hidden={section !== "dna"}>
            <TasteSummary value={draft} />
            <h2>採用する原則・根拠</h2>
            <Principles
              values={draft.principles}
              onChange={(principles) => setDraft({ ...draft, principles })}
            />
          </div>
        </fieldset>
      </form>
      <section hidden={section !== "references"}>
        <h2>共通の参考</h2>
        <p>
          保存先:
          自分の好み。分析は明示的に採用した項目だけが原則候補になります。登録・削除後に「共通の好みを保存」で参考の版を確定してください。
        </p>
        <fieldset className="editor-fieldset" disabled={action.busy || unread}>
          <References
            onChange={setReferences}
            onBusyChange={(busy, error) => {
              setReferencesBusy(busy);
              setReferenceError(error ?? "");
            }}
            onAdopt={(p) => {
              setDraft((d) => ({
                ...d,
                principles: [...d.principles.filter((v) => v.id !== p.id), p],
              }));
              setSection("dna");
            }}
          />
        </fieldset>
      </section>
      <p className="scope-help">
        共通の好みを更新しても、既存プロジェクトには自動反映されません。
      </p>
    </main>
  );
}

function ProjectArea({ step, taste }: { step: string; taste: TasteRevision }) {
  const scope = useScope();
  const q = useQuery({
    queryKey: ["project", scope.id],
    queryFn: () => req<ProjectData>(scope.api),
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
      {q.error && (
        <div className="project-summary">
          <p role="alert">
            プロジェクトを取得できませんでした。表示中の確定版と入力は保持しています。
            {q.error.message}
          </p>
          <button
            className="button"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            プロジェクトを再取得
          </button>
        </div>
      )}
      {(data.project.archivedAt ||
        taste.revision !==
          data.current.snapshot.sourceTasteProfileRevision) && (
        <div className="project-summary" role="status">
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
      )}
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
  const [draft, setDraft, error, draftRecovery] = useDraft(
    `tasteprint.${scope.id}.overview`,
    {
      baseRevision: current.revision,
      brief: current.snapshot.brief,
      policies: current.snapshot.policies,
    },
    parseOverviewDraft,
  );
  const [diff, setDiff] = useState<{
      baseRevision: number;
      baseProfileRevision: number;
      changes: TasteDiff[];
    }>(),
    [choices, setChoices] = useState<Record<string, "adopt" | "keep">>({}),
    [promote, setPromote] = useState<string[]>([]),
    [confirmation, setConfirmation] = useState<{
      projectId: string;
      source: string;
      destination: string;
      ids: string[];
    }>();
  const selected = current.snapshot.policies.filter((p) =>
    promote.includes(p.id),
  );
  const selectedIds = selected.map((p) => p.id);
  const signature = (values: Principle[]) =>
    JSON.stringify(
      [...values]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => [p.id, p.target, p.text, p.reason, p.sources, p.locked]),
    );
  const source = signature(selected);
  const destination = JSON.stringify(
    [...selectedIds].sort().map((id) => {
      const existing = taste.snapshot.principles.find((p) => p.id === id);
      return [id, existing ? signature([existing]) : null];
    }),
  );
  const confirmed =
    !!confirmation &&
    confirmation.projectId === scope.id &&
    confirmation.source === source &&
    confirmation.destination === destination &&
    confirmation.ids.length === selectedIds.length &&
    confirmation.ids.every((id) => selectedIds.includes(id));
  useEffect(() => {
    if (
      draft.baseRevision !== current.revision &&
      JSON.stringify(draft.brief) === JSON.stringify(current.snapshot.brief) &&
      JSON.stringify(draft.policies) ===
        JSON.stringify(current.snapshot.policies)
    )
      setDraft((d) => ({ ...d, baseRevision: current.revision }));
  }, [current.revision]);
  const [notice, setNotice] = useState("");
  const dirty =
    JSON.stringify([draft.brief, draft.policies]) !==
    JSON.stringify([current.snapshot.brief, current.snapshot.policies]);
  const stale = draft.baseRevision !== current.revision;
  const sync = async () => {
    await refresh();
    await client.invalidateQueries({ queryKey: ["projects"] });
  };
  return (
    <main className="projects-page">
      <div className="eyebrow">PROJECT OVERVIEW</div>
      <h1>{current.snapshot.brief.name}</h1>
      <p>概要・設計方針 · 確定 r{current.revision}</p>
      <EditorActions
        scope={current.snapshot.brief.name}
        target="概要・方針"
        revision={current.revision}
        dirty={dirty}
        busy={action.busy}
        stale={stale}
        error={action.error || error}
        notice={notice}
        disabledReason={
          stale
            ? "下書きの版が古くなっています。最新の確定版を読み込んでください。"
            : !dirty
              ? "保存する変更はありません。"
              : !draft.brief.name.trim()
                ? "プロジェクト名を入力してください。"
                : undefined
        }
      >
        <button
          className="button"
          disabled={action.busy || draftRecovery.blocked || (!dirty && !stale)}
          onClick={() => {
            action.clear();
            setDraft({
              baseRevision: current.revision,
              brief: current.snapshot.brief,
              policies: current.snapshot.policies,
            });
          }}
        >
          {stale ? "最新の確定版を読み込む" : "未保存の変更を取り消す"}
        </button>
        <button
          form="overview-form"
          className="button primary"
          disabled={
            action.busy ||
            draftRecovery.blocked ||
            stale ||
            !dirty ||
            !draft.brief.name.trim()
          }
        >
          概要・方針を保存
        </button>
      </EditorActions>
      <DraftReadRecovery
        label="概要・方針"
        recovery={draftRecovery}
        disabled={action.busy}
      />
      <form
        id="overview-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            let r: ProjectData["current"];
            try {
              r = await req<ProjectData["current"]>(scope.api, draft);
            } catch (e) {
              if ((e as { status?: number }).status === 409) await sync();
              throw e;
            }
            setDraft({ ...draft, baseRevision: r.revision });
            await commitProjectRevision(client, scope.id, r);
            await sync();
            setNotice("概要・方針を保存しました");
          });
        }}
      >
        <fieldset
          disabled={action.busy || draftRecovery.blocked}
          className="overview-fields"
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
        </fieldset>
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
              <details>
                <summary>変更前・変更後の詳細</summary>
                <pre>
                  {JSON.stringify(d.before, null, 2)} →{" "}
                  {JSON.stringify(d.after, null, 2)}
                </pre>
              </details>
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
                await commitProjectRevision(client, scope.id, r);
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
            disabled={action.busy}
            onChange={(e) => {
              setPromote(
                e.target.checked
                  ? [...promote, p.id]
                  : promote.filter((id) => id !== p.id),
              );
              setConfirmation(undefined);
            }}
          />
          {p.text} · 理由: {p.reason} · 出典: {p.sources.join(", ")}
        </label>
      ))}
      {confirmation && !confirmed && (
        <p role="alert">
          追加する原則または共通側の同じ原則が更新されています。内容を確認し、追加の確認をやり直してください。
        </p>
      )}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={action.busy || !selectedIds.length}
          onChange={(e) =>
            setConfirmation(
              e.target.checked
                ? {
                    projectId: scope.id,
                    source,
                    destination,
                    ids: selectedIds,
                  }
                : undefined,
            )
          }
        />
        選択した原則・理由・出典を共通へ追加することを確認しました
      </label>
      <button
        className="button"
        disabled={action.busy || !confirmed || !selectedIds.length}
        onClick={() =>
          void action.run(async () => {
            if (!confirmed || !confirmation)
              throw new Error("内容を確認し、追加の確認をやり直してください。");
            const r = await req<TasteRevision>(`${scope.api}/promote`, {
              baseRevision: current.revision,
              baseProfileRevision: taste.revision,
              ids: confirmation.ids,
            });
            await commitProfile(client, r);
            setPromote([]);
            setConfirmation(undefined);
            await client.invalidateQueries({ queryKey: ["profile"] });
          })
        }
      >
        選択した判断を共通に追加
      </button>
    </main>
  );
}
export function ExportHistory({ revision }: { revision: number }) {
  const scope = useScope(),
    action = useAction(),
    client = useQueryClient();
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
      <p>
        Draft · 未確認: Components / Patterns
        の個別仕様・全状態、実アプリでの設計とアクセシビリティ。
      </p>
      {(["include", "omit"] as const).map((imageMode) => (
        <button
          key={imageMode}
          className="button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const r = await req<ExportRecord>(`${scope.api}/exports`, {
                baseRevision: revision,
                bundle: true,
                imageMode,
              });
              download(r, ".zip");
              await commitExport(client, r);
              await query.refetch();
            })
          }
        >
          {action.busy
            ? "出力中…"
            : imageMode === "include"
              ? "一括 ZIP を生成・再試行"
              : "画像なし ZIP を生成"}
        </button>
      ))}
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
              await commitExport(client, r);
              await query.refetch();
            })
          }
        >
          {label}
        </button>
      ))}
      {action.error && <p role="alert">{action.error}</p>}
      {(query.error || query.isFetching) && (
        <div>
          {query.error ? (
            <p role="alert">
              Export履歴を取得できませんでした。表示中の履歴は保持しています。
              {query.error.message}
            </p>
          ) : (
            <p role="status">Export履歴を取得中…</p>
          )}
          <button
            className="button"
            disabled={action.busy || query.isFetching}
            onClick={() => void query.refetch()}
          >
            Export履歴を再取得
          </button>
        </div>
      )}
      <h2>Export履歴</h2>
      {query.data?.map((r) => (
        <article key={r.id}>
          <h3>
            r{r.revision} · 共通の好み r{r.sourceTasteProfileRevision ?? "なし"}
          </h3>
          <p>
            {r.createdAt}{" "}
            {r.templateVersion &&
              `· Draft · ${r.imageMode === "omit" ? "画像なし" : "PNG 3画面"}`}
          </p>
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
