import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Code2,
  Fingerprint,
  Image,
  Layers,
  LayoutTemplate,
  LoaderCircle,
  Monitor,
  Palette,
  PanelRightClose,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tablet,
  X,
} from "lucide-react";
import { configurationDiff, affectedScreens } from "../domain/library";
import { LibraryEditor } from "./components/LibraryEditor";
import { FoundationEditor } from "./components/FoundationEditor";
import {
  foundationRequest as requestFoundation,
  parseRevision,
  type Revision,
  type Candidate,
} from "./foundation-api";
import { projectMarkdown } from "../domain/project-export";
import { References } from "./components/References";
import { PreviewFrame } from "./components/PreviewFrame";
import { ReviewPanel } from "./components/ReviewPanel";
import { initialState, type WorkspaceState } from "./state";
import { profile, type Design } from "../domain/design";

export const steps = [
  {
    id: "inspiration",
    name: "Inspiration",
    label: "好きの手がかりを集める",
    icon: Image,
  },
  {
    id: "taste",
    name: "Taste",
    label: "見比べて、好みを見つける",
    icon: Fingerprint,
  },
  {
    id: "foundation",
    name: "Foundation",
    label: "感覚を、具体的なかたちに。",
    icon: SlidersHorizontal,
  },
  {
    id: "components",
    name: "Components",
    label: "細部にも、あなたらしさを。",
    icon: Layers,
  },
  {
    id: "patterns",
    name: "Patterns",
    label: "使い方まで、デザインする。",
    icon: LayoutTemplate,
  },
  {
    id: "preview",
    name: "Preview",
    label: "いつもの画面で、確かめる。",
    icon: Monitor,
  },
  {
    id: "review",
    name: "AI Review",
    label: "最初の感覚に、立ち返る。",
    icon: ClipboardCheck,
  },
  {
    id: "export",
    name: "Export",
    label: "あなたの感覚を、次の制作へ。",
    icon: ArrowDownToLine,
  },
];
const tabs = [
  "Colors",
  "Typography",
  "Spacing",
  "Radius",
  "Borders",
  "Shadows",
  "Motion",
  "Breakpoints",
];

function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}

import { Link, useScope, draftKey, jsonRequest } from "./scope";
import { ExportHistory } from "./projects";
export function Workspace({
  initial,
  projectName,
}: {
  initial: Revision;
  projectName: string;
}) {
  const scope = useScope();
  const queryClient = useQueryClient();
  const foundationRequest = <T,>(path: string, body?: unknown) =>
    requestFoundation<T>(path, body, `${scope.api}/foundation`);
  const loadProject = (): WorkspaceState => {
    try {
      const draft = localStorage.getItem(draftKey(scope.id));
      if (draft) return JSON.parse(draft);
    } catch {}
    return {
      ...initialState,
      references: [],
      design: initial.design,
      answers: initial.snapshot?.taste.answers ?? {},
    };
  };
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current =
    steps.find((s) => s.id === path.split("/").at(-1)) || steps[2];
  const [state, setState] = useState<WorkspaceState>(loadProject);
  const [draftBase, setDraftBase] = useState<number>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(draftKey(scope.id)) || "null")
          ?.baseRevision ?? initial.revision
      );
    } catch {
      return initial.revision;
    }
  });
  const [history, setHistory] = useState<Design[]>([]);
  const [saved, setSaved] = useState<Revision | null>(initial);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [foundationError, setFoundationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [validInput, setValidInput] = useState(true);
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => {
    let active = true;
    foundationRequest<{ current: Revision | null; history: Revision[] }>("/")
      .then(async (data) => {
        const current =
          data.current ??
          (await foundationRequest<Revision>("/initialize", {
            design: initial.design,
            dna: profile(initial.snapshot?.taste.answers ?? {}),
          }));
        if (!active) return;
        setSaved(parseRevision(current));
        setRevisions(data.history.length ? data.history : [current]);
        // Drafts are scoped and intentionally retained until the user saves or discards.
        setFoundationError("");
      })
      .catch((e) => {
        if (active)
          setFoundationError(
            `${e.message} Inspirationで接続後、Foundationに戻ってください。`,
          );
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function commit(path: string, body: unknown) {
    setBusy(true);
    try {
      const result = parseRevision(
        await foundationRequest<Revision>(
          path,
          path === "/save"
            ? {
                ...(body as object),
                baseRevision: draftBase,
                dna: profile(saved?.snapshot?.taste.answers ?? state.answers),
              }
            : body,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ["project", scope.id] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSaved(result);
      setDraftBase(result.revision);
      setState((s) => ({ ...s, design: result.design }));
      const data = await foundationRequest<{ history: Revision[] }>("/");
      setRevisions(data.history);
      setFoundationError("");
      proposal.reset();
      setHistory([]);
      setNotice("設計を保存しました");
    } catch (e) {
      setFoundationError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  const [tab, setTab] = useState("Colors");
  const [screen, setScreen] = useState("list");
  const [width, setWidth] = useState("desktop");
  const [chatOpen, setChatOpen] = useState(true);
  const [prompt, setPrompt] = useState(
    () => localStorage.getItem(`tasteprint.${scope.id}.prompt`) || "",
  );
  useEffect(() => {
    try {
      localStorage.setItem(`tasteprint.${scope.id}.prompt`, prompt);
    } catch {
      setSaveError(true);
    }
  }, [prompt]);
  const conversation = useQuery({
    queryKey: ["conversations", scope.id],
    queryFn: () =>
      jsonRequest<{ id: string; text: string }[]>(`${scope.api}/conversations`),
  });
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [component, setComponent] = useState("Button");
  const [pattern, setPattern] = useState("ListPage");
  const connection = useQuery({
    queryKey: ["foundation-connection", scope.id, !!saved],
    enabled: !!saved,
    queryFn: async () => {
      const response = await fetch("/api/connection");
      if (!response.ok) throw new Error("接続できません");
      return response.json() as Promise<{ state: "ready" | "login-required" }>;
    },
  });
  const proposal = useMutation({
    mutationFn: async (text: string) => {
      if (
        !saved ||
        JSON.stringify(saved.design) !== JSON.stringify(state.design)
      )
        throw new Error("先にFoundationの変更を保存してください。");
      await jsonRequest(`${scope.api}/conversations`, {
        baseRevision: saved.revision,
        text,
      });
      await conversation.refetch();
      const data = await foundationRequest<{ candidates: Candidate[] }>(
        "/proposals",
        { baseRevision: saved.revision, prompt: text },
      );
      setCandidateIndex(0);
      return {
        supported: true as const,
        ...data.candidates[0],
        candidates: data.candidates,
      };
    },
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        draftKey(scope.id),
        JSON.stringify({ ...state, baseRevision: draftBase }),
      );
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [state, draftBase]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  function updateDesign(patch: Partial<Design>) {
    setHistory((h) => [...h.slice(-19), state.design]);
    setState((s) => ({ ...s, design: { ...s.design, ...patch } }));
    proposal.reset();
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setState((s) => ({ ...s, design: previous }));
    setHistory((h) => h.slice(0, -1));
    proposal.reset();
    setNotice("ひとつ前の設定に戻しました");
  }
  const displayDesign = proposal.data?.supported
    ? proposal.data.candidates[candidateIndex].design
    : state.design;
  const markdown = saved?.snapshot
    ? projectMarkdown({ ...saved, snapshot: saved.snapshot })
    : "";
  const ask = (text: string) => {
    if (!text.trim()) return;
    setPrompt(text);
    proposal.mutate(text);
  };

  return (
    <div className={`workspace ${chatOpen ? "" : "chat-closed"}`}>
      <aside className="sidebar">
        <Link to="/$step" params={{ step: "foundation" }} className="wordmark">
          <Fingerprint size={30} strokeWidth={1.7} />
          <span>
            tasteprint<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="project-switch">
          <span className="project-monogram">P</span>
          <div>
            {projectName}
            <small>My design language</small>
          </div>
          <Pill>01</Pill>
        </div>
        <div className="nav-label">YOUR DESIGN JOURNEY</div>
        <nav>
          {steps.map((s, i) => (
            <Link
              key={s.id}
              to="/$step"
              params={{ step: s.id }}
              className={`nav-item ${current.id === s.id ? "active" : ""}`}
            >
              <s.icon size={17} strokeWidth={1.6} />
              <span>{s.name}</span>
              <small>{String(i + 1).padStart(2, "0")}</small>
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="tiny-orbit">✳</div>
          <p>
            Good design starts
            <br />
            with knowing your taste.
          </p>
          <span>あなたの「好き」が、設計の起点。</span>
        </div>
        <div className="sidebar-bottom">
          <span className="local-dot" /> Local workspace{" "}
          <span className="version">v0.1</span>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={13} />
            <span>{current.name}</span>
          </div>
          <div className="topbar-actions">
            <span className={`save-status ${saveError ? "save-error" : ""}`}>
              {saveError ? (
                "保存容量が不足しています"
              ) : (
                <>
                  <span className="local-dot" />{" "}
                  {saved &&
                  JSON.stringify(saved.design) === JSON.stringify(state.design)
                    ? `Foundation r${saved.revision} 保存済み`
                    : "Foundation 未確定"}
                </>
              )}
            </span>
            <button
              className="icon-button"
              aria-label="元に戻す"
              title="元に戻す"
              onClick={undo}
              disabled={!history.length}
            >
              <RotateCcw size={16} />
            </button>
            <Link
              className="button small"
              to="/$step"
              params={{ step: "export" }}
            >
              <ArrowDownToLine size={14} /> Export
            </Link>
            <button
              className="icon-button chat-toggle"
              aria-label="対話パネルを切り替え"
              onClick={() => setChatOpen((v) => !v)}
            >
              <Sparkles size={17} />
            </button>
          </div>
        </header>
        <div className="content-grid">
          <main className="main-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {String(steps.indexOf(current) + 1).padStart(2, "0")} / DESIGN
                  YOUR OWN LANGUAGE
                </div>
                <h1>
                  {current.name}
                  <span className="heading-period">.</span>
                </h1>
                <p>{current.label}</p>
              </div>
              <Pill>
                <span className="local-dot" /> Working draft
              </Pill>
            </div>
            {current.id === "foundation" && (
              <>
                <div
                  className="foundation-tabs"
                  role="tablist"
                  aria-label="Foundation categories"
                >
                  {tabs.map((t) => (
                    <button
                      role="tab"
                      aria-selected={t === tab}
                      key={t}
                      onClick={() => setTab(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <section className="foundation-editor">
                  <div className="section-label">
                    <span>
                      {tab === "Colors"
                        ? "A quiet palette, with a point of view."
                        : "Small decisions. A consistent language."}
                    </span>
                    <span className="mono">
                      {tab === "Colors"
                        ? "01 — PALETTE"
                        : `${String(tabs.indexOf(tab) + 1).padStart(2, "0")} — ${tab.toUpperCase()}`}
                    </span>
                  </div>
                  <fieldset
                    className="foundation-inputs"
                    disabled={!saved || busy}
                  >
                    <FoundationEditor
                      design={state.design}
                      tab={tab}
                      onChange={updateDesign}
                      onValidityChange={setValidInput}
                    />
                  </fieldset>
                  {saved && draftBase !== saved.revision && (
                    <p role="alert">
                      下書きの版が古くなっています。確定内容を確認し、「未保存の変更を取り消す」で読み直してください。
                    </p>
                  )}
                  {foundationError && (
                    <p className="error-text" role="alert">
                      {foundationError}
                    </p>
                  )}
                  <div className="proposal-actions">
                    <button
                      className="button primary"
                      disabled={
                        !saved ||
                        !validInput ||
                        busy ||
                        JSON.stringify(saved.design) ===
                          JSON.stringify(state.design)
                      }
                      onClick={() =>
                        void commit("/save", {
                          baseRevision: saved!.revision,
                          design: state.design,
                          reason: "手動でFoundationを編集",
                          requestId: crypto.randomUUID(),
                        })
                      }
                    >
                      変更を保存
                    </button>
                    <button
                      className="button"
                      disabled={!saved || busy}
                      onClick={() => {
                        setState((s) => ({ ...s, design: saved!.design }));
                        setDraftBase(saved!.revision);
                        proposal.reset();
                        setHistory([]);
                      }}
                    >
                      未保存の変更を取り消す
                    </button>
                  </div>
                  <details>
                    <summary>
                      確定履歴（revision {saved?.revision ?? "未接続"}）
                    </summary>
                    {revisions
                      .slice()
                      .reverse()
                      .map((r) => (
                        <div key={r.revision}>
                          r{r.revision} · {r.reason} ·{" "}
                          {new Date(r.createdAt).toLocaleString()}{" "}
                          <button
                            className="button small"
                            disabled={busy || r.revision === saved?.revision}
                            onClick={() =>
                              void commit("/restore", {
                                baseRevision: saved!.revision,
                                target: r.revision,
                                requestId: crypto.randomUUID(),
                              })
                            }
                          >
                            r{r.revision}を復元
                          </button>
                        </div>
                      ))}
                  </details>
                </section>
                <div className="section-heading">
                  <div>
                    <h2>
                      In context <span>実画面で確かめる</span>
                    </h2>
                  </div>
                  <span className="live-label">
                    <span className="local-dot" /> Live preview
                  </span>
                </div>
                <PreviewArea
                  design={displayDesign}
                  screen={screen}
                  setScreen={setScreen}
                  width={width}
                  setWidth={setWidth}
                />
                <div className="preview-note">
                  <CircleHelp size={14} />
                  <span>
                    色だけでなく、文字・余白・構成との相性も見てみましょう。
                  </span>
                  <Link to="/$step" params={{ step: "preview" }}>
                    Open preview <ArrowRight size={13} />
                  </Link>
                </div>
              </>
            )}
            {current.id === "inspiration" && (
              <>
                <p>保存先: {projectName}（このプロジェクト固有）</p>
                <References
                  onChange={(references) =>
                    setState((s) => ({
                      ...s,
                      references: references.map((r) => ({
                        id: r.id,
                        name: r.name,
                        url: r.url,
                        aspects: r.selections.map((s) => s.aspect),
                        principles: r.accepted.map(
                          (i) => r.analysis!.findings[i],
                        ),
                      })),
                    }))
                  }
                />
                <div className="bottom-next">
                  <span>「好き」の輪郭を、少しずつ。</span>
                  <Link
                    className="button primary"
                    to="/$step"
                    params={{ step: "taste" }}
                  >
                    好みを見比べる <ArrowRight size={15} />
                  </Link>
                </div>
              </>
            )}
            {current.id === "taste" && (
              <section>
                <h2>採用した好み</h2>
                <p>
                  このプロジェクトの確定版を使用しています。共通の回答変更は「自分の好み」で保存し、概要から差分を取り込んでください。
                </p>
                <pre>{JSON.stringify(saved?.snapshot?.taste, null, 2)}</pre>
                <Link to="/$step" params={{ step: "taste" }}>
                  自分の好みを見直す
                </Link>
              </section>
            )}
            {current.id === "preview" && (
              <>
                <div className="intro-strip">
                  <Monitor size={20} />
                  <p>
                    一覧・設定・フォームを切り替えて、ひとつの設計を確かめる。
                    <small>
                      検索、フィルタ、フォーム入力を実際に試せます。
                    </small>
                  </p>
                </div>
                <PreviewArea
                  design={displayDesign}
                  screen={screen}
                  setScreen={setScreen}
                  width={width}
                  setWidth={setWidth}
                />
                <div className="preview-settings">
                  <Range
                    label="角丸"
                    value={state.design.radius}
                    min={0}
                    max={20}
                    onChange={(radius) => updateDesign({ radius })}
                  />
                  <Range
                    label="余白"
                    value={state.design.spacing}
                    min={8}
                    max={24}
                    onChange={(spacing) => updateDesign({ spacing })}
                  />
                </div>
              </>
            )}
            {current.id === "components" && (
              <>
                <div className="foundation-tabs">
                  {[
                    "Button",
                    "Input",
                    "Select",
                    "Checkbox",
                    "Tabs",
                    "Dialog",
                    "Table",
                    "Badge",
                  ].map((c) => (
                    <button
                      key={c}
                      aria-pressed={component === c}
                      onClick={() => setComponent(c)}
                      className={component === c ? "active-tab" : ""}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <fieldset
                  disabled={!saved || busy}
                  className="foundation-inputs"
                >
                  <LibraryEditor
                    design={state.design}
                    kind="components"
                    name={component}
                    onChange={updateDesign}
                  />
                </fieldset>
                <PreviewFrame
                  design={displayDesign}
                  screen={`component:${component}`}
                />
              </>
            )}
            {current.id === "patterns" && (
              <>
                <div className="pattern-grid">
                  {[
                    "PageHeader",
                    "FilterBar",
                    "ListPage",
                    "SettingsSection",
                    "FormSection",
                    "EmptyState",
                  ].map((p, i) => (
                    <button
                      className={`pattern-card ${pattern === p ? "selected" : ""}`}
                      key={p}
                      onClick={() => {
                        setPattern(p);
                        setScreen(
                          p === "SettingsSection"
                            ? "settings"
                            : p === "FormSection"
                              ? "form"
                              : "list",
                        );
                      }}
                    >
                      <div className={`pattern-drawing pattern-${i}`}>
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <span>{p}</span>
                      {pattern === p && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <div className="section-heading">
                  <h2>
                    {pattern} <span>使用例</span>
                  </h2>
                  <Pill>Template</Pill>
                </div>
                <fieldset
                  disabled={!saved || busy}
                  className="foundation-inputs"
                >
                  <LibraryEditor
                    design={state.design}
                    kind="patterns"
                    name={pattern}
                    onChange={updateDesign}
                  />
                </fieldset>
                <PreviewFrame
                  design={displayDesign}
                  screen={`pattern:${pattern}`}
                />
              </>
            )}
            {(current.id === "components" || current.id === "patterns") && (
              <section className="foundation-editor">
                {saved && draftBase !== saved.revision && (
                  <p role="alert">
                    下書きの版が古くなっています。確定内容を確認し、「未保存の変更を取り消す」で読み直してください。
                  </p>
                )}
                {foundationError && (
                  <p className="error-text" role="alert">
                    {foundationError}
                  </p>
                )}
                <div className="proposal-actions">
                  <button
                    className="button primary"
                    disabled={
                      !saved ||
                      !validInput ||
                      busy ||
                      JSON.stringify(saved.design) ===
                        JSON.stringify(state.design)
                    }
                    onClick={() =>
                      void commit("/save", {
                        baseRevision: saved!.revision,
                        design: state.design,
                        reason: "手動でComponents / Patternsを編集",
                        requestId: crypto.randomUUID(),
                      })
                    }
                  >
                    変更を保存
                  </button>
                  <button
                    className="button"
                    disabled={!saved || busy}
                    onClick={() => {
                      setState((s) => ({ ...s, design: saved!.design }));
                      setDraftBase(saved!.revision);
                      proposal.reset();
                      setHistory([]);
                    }}
                  >
                    未保存の変更を取り消す
                  </button>
                </div>
                <details>
                  <summary>
                    確定履歴（revision {saved?.revision ?? "未接続"}）
                  </summary>
                  {revisions
                    .slice()
                    .reverse()
                    .map((r) => (
                      <div key={r.revision}>
                        r{r.revision} · {r.reason} ·{" "}
                        {new Date(r.createdAt).toLocaleString()}{" "}
                        <button
                          className="button small"
                          disabled={busy || r.revision === saved?.revision}
                          onClick={() =>
                            void commit("/restore", {
                              baseRevision: saved!.revision,
                              target: r.revision,
                              requestId: crypto.randomUUID(),
                            })
                          }
                        >
                          r{r.revision}を復元
                        </button>
                      </div>
                    ))}
                </details>
              </section>
            )}
            {current.id === "review" && (
              <ReviewPanel
                saved={saved}
                applied={(r) => {
                  setSaved(r);
                  setDraftBase(r.revision);
                  void queryClient.invalidateQueries({
                    queryKey: ["project", scope.id],
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ["projects"],
                  });
                  setState((s) => ({ ...s, design: r.design }));
                  setRevisions((v) => [...v, r]);
                }}
              />
            )}
            {current.id === "export" && (
              <>
                <div className="export-banner">
                  <div>
                    <Code2 size={24} />
                    <h2>Your taste, written down.</h2>
                    <p>
                      Foundationの確定revision {saved?.revision ?? "未接続"}{" "}
                      と回答を出力します。未保存の編集と未採用候補は含みません。
                    </p>
                  </div>
                  <Pill>Draft export</Pill>
                </div>
                {saved && <ExportHistory revision={saved.revision} />}
                <div className="code-preview">
                  <div>
                    <span className="local-dot" /> DESIGN.md{" "}
                    <span>MARKDOWN</span>
                  </div>
                  <pre>{markdown}</pre>
                </div>
                <p className="muted export-note">
                  一括 ZIP には DTCG トークン、React テンプレート、3画面の PNG、導入手順と manifest が含まれます。
                </p>
              </>
            )}
            <footer className="page-footer">
              <span>TASTEPRINT / PERSONAL DESIGN WORKSPACE</span>
              <span>Made of your decisions.</span>
            </footer>
          </main>
          {chatOpen && (
            <aside className="conversation">
              <div className="conversation-header">
                <div>
                  <Sparkles size={17} />
                  <strong>Design companion</strong>
                </div>
                <button
                  className="icon-button"
                  aria-label="対話パネルを閉じる"
                  onClick={() => setChatOpen(false)}
                >
                  <PanelRightClose size={16} />
                </button>
              </div>
              <div className="connection-status">
                <span
                  className={connection.isError ? "offline-dot" : "local-dot"}
                />
                {connection.isError
                  ? "APIに接続できません"
                  : connection.data?.state === "ready"
                    ? "Codex接続準備完了"
                    : "Codex認証を確認してください"}
                <span>ChatGPT認証を使用</span>
              </div>
              <div className="conversation-content">
                {conversation.data?.map((m) => (
                  <p key={m.id}>{m.text}</p>
                ))}
                <div className="companion-avatar">
                  <Fingerprint size={23} />
                </div>
                <h3>A little more you.</h3>
                <p>
                  曖昧な「好き」を、ひとつずつ。
                  <br />
                  実画面を見ながら、あなたの言葉で
                  <br />
                  調整していきましょう。
                </p>
                <div className="context-label">CURRENT CONTEXT</div>
                <div className="context-box">
                  <Palette size={16} />
                  <div>
                    {current.name}
                    <small>{projectName}</small>
                  </div>
                </div>
                <div className="companion-message">
                  <div>
                    <Sparkles size={13} /> Try a small change
                  </div>
                  <p>
                    たとえば、こんなふうに。
                    <br />
                    提案はまずプレビューで確認して、
                    <br />
                    気に入ったら採用できます。
                  </p>
                </div>
                <div className="suggested-prompts">
                  {[
                    "角丸をもう少し弱くしたい",
                    "一覧の余白を詰めたい",
                    "アクセントを青に変更",
                  ].map((text) => (
                    <button
                      key={text}
                      disabled={proposal.isPending}
                      onClick={() => ask(text)}
                    >
                      {text}
                      <ArrowUp size={12} />
                    </button>
                  ))}
                </div>
                {proposal.isPending && (
                  <p className="muted" role="status">
                    <LoaderCircle size={14} className="spin" />{" "}
                    Codex候補を作成中…
                  </p>
                )}
                {proposal.isError && (
                  <p className="error-text" role="alert">
                    {proposal.error.message}
                  </p>
                )}
                {proposal.data && (
                  <div className="proposal" role="status">
                    <span className="context-label">CODEX PROPOSAL</span>
                    {proposal.data.supported ? (
                      <>
                        <div className="proposal-actions">
                          {proposal.data.candidates.map((c, i) => (
                            <button
                              className="button small"
                              aria-pressed={candidateIndex === i}
                              key={c.id}
                              onClick={() => setCandidateIndex(i)}
                            >
                              候補 {i + 1}
                            </button>
                          ))}
                        </div>
                        <p>
                          {proposal.data.candidates[candidateIndex].explanation}
                        </p>
                        <div className="proposal-diff">
                          {configurationDiff(
                            state.design,
                            proposal.data.candidates[candidateIndex].design,
                          ).map((change) => (
                            <div key={change.path}>
                              <span>
                                {change.path}
                                <small>
                                  影響: {affectedScreens(change.path)}
                                </small>
                              </span>
                              <del>{JSON.stringify(change.before)}</del>
                              <ArrowRight size={11} />
                              <strong>{JSON.stringify(change.after)}</strong>
                            </div>
                          ))}
                        </div>
                        <small>プレビューに仮反映しています</small>
                        <div className="proposal-actions">
                          <button
                            className="button primary small"
                            disabled={busy}
                            onClick={() => {
                              if (proposal.data?.supported) {
                                void commit("/apply", {
                                  id: proposal.data.candidates[candidateIndex]
                                    .id,
                                });
                              }
                            }}
                          >
                            採用する <Check size={12} />
                          </button>
                          <button
                            className="button small"
                            onClick={() => proposal.reset()}
                          >
                            見送る
                          </button>
                        </div>
                      </>
                    ) : (
                      <p>候補はありません。</p>
                    )}
                  </div>
                )}
              </div>
              <div className="conversation-input">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask(prompt);
                  }}
                >
                  <label className="sr-only" htmlFor="prompt">
                    デザインへのリクエスト
                  </label>
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="もう少し、こんな感じに…"
                    maxLength={1000}
                  />
                  <div>
                    <span>試して、選んで、あなたの形に。</span>
                    <button
                      aria-label="提案を依頼"
                      disabled={!prompt.trim() || proposal.isPending}
                    >
                      <ArrowUp size={17} />
                    </button>
                  </div>
                </form>
                <p>
                  このプロジェクトの確定設計・用途・採用した好みと根拠・リクエストをCodexへ送信します
                </p>
              </div>
            </aside>
          )}
        </div>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button aria-label="通知を閉じる" onClick={() => setNotice("")}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
function Range({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <strong>
          {value}
          <small>px</small>
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div>
        <small>{min}px</small>
        <small>{max}px</small>
      </div>
    </label>
  );
}
function PreviewArea({
  design,
  screen,
  setScreen,
  width,
  setWidth,
}: {
  design: Design;
  screen: string;
  setScreen: (s: string) => void;
  width: string;
  setWidth: (s: string) => void;
}) {
  return (
    <div className="preview-container">
      <div className="preview-toolbar">
        <div>
          {[
            ["list", "List"],
            ["settings", "Settings"],
            ["form", "Form"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={screen === id ? "selected" : ""}
              onClick={() => setScreen(id)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="viewport-buttons">
          {[
            { id: "desktop", Icon: Monitor, text: "Desktop 1440px" },
            { id: "tablet", Icon: Tablet, text: "Tablet 768px" },
            { id: "mobile", Icon: Smartphone, text: "Mobile 390px" },
          ].map(({ id, Icon, text }) => (
            <button
              aria-label={text}
              aria-pressed={width === id}
              className={width === id ? "selected" : ""}
              key={id}
              onClick={() => setWidth(id)}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
      <div className={`preview-stage viewport-${width}`}>
        <PreviewFrame
          design={design}
          screen={screen}
          width={width === "mobile" ? 390 : width === "tablet" ? 768 : 1440}
        />
      </div>
    </div>
  );
}
