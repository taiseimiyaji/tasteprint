import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Code2,
  Columns3,
  Fingerprint,
  Image,
  Layers,
  LayoutTemplate,
  LoaderCircle,
  Monitor,
  Palette,
  PanelRightClose,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  X,
} from "lucide-react";
import { api } from "./api";
import { References } from "./components/References";
import { Preview } from "./components/Preview";
import {
  initialState,
  loadState,
  storageKey,
  type WorkspaceState,
} from "./state";
import {
  designMarkdown,
  profile,
  questions,
  type Choice,
  type Design,
} from "../domain/design";

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
];
const accents = [
  { color: "#65764d", name: "Moss" },
  { color: "#526f99", name: "Slate blue" },
  { color: "#a3664c", name: "Terracotta" },
  { color: "#847298", name: "Muted violet" },
  { color: "#3e807b", name: "Eucalyptus" },
];
function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}

export function Workspace() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = steps.find((s) => s.id === path.slice(1)) || steps[2];
  const [state, setState] = useState<WorkspaceState>(loadState);
  const [history, setHistory] = useState<Design[]>([]);
  const [tab, setTab] = useState("Colors");
  const [screen, setScreen] = useState("list");
  const [width, setWidth] = useState("desktop");
  const [chatOpen, setChatOpen] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [reviewed, setReviewed] = useState<Design | null>(null);
  const [component, setComponent] = useState("Button");
  const [pattern, setPattern] = useState("ListPage");
  const connection = useQuery({
    queryKey: ["connection"],
    queryFn: async () => {
      const response = await api.api.connection.$get();
      if (!response.ok) throw new Error("API connection failed");
      return response.json();
    },
  });
  const proposal = useMutation({
    mutationFn: async (text: string) => {
      const response = await api.api.proposals.$post({
        json: { prompt: text, design: state.design },
      });
      if (!response.ok)
        throw new Error(
          "提案を取得できませんでした。APIの起動状態を確認してください。",
        );
      return response.json();
    },
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [state]);
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
  const answered = Object.keys(state.answers).length;
  const dna = profile(state.answers);
  const displayDesign = proposal.data?.supported
    ? proposal.data.design
    : state.design;
  const markdown = designMarkdown(
    state.design,
    state.answers,
    state.references,
  );
  const ask = (text: string) => {
    if (!text.trim()) return;
    setPrompt(text);
    proposal.mutate(text);
  };
  function answer(choice: Choice) {
    const question = questions[questionIndex];
    setState((s) => ({
      ...s,
      answers: { ...s.answers, [question.id]: choice },
    }));
    if (questionIndex < questions.length - 1) setQuestionIndex((i) => i + 1);
    else setNotice("比較が完了しました。回答はいつでも見直せます");
  }

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
            Personal workspace<small>My design language</small>
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
                  <span className="local-dot" /> ブラウザに保存済み
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
                  {tab === "Colors" ? (
                    <>
                      <div className="palette-row">
                        {[
                          { name: "Canvas", color: "#f8f8f4", hex: "#F8F8F4" },
                          { name: "Surface", color: "#ffffff", hex: "#FFFFFF" },
                          { name: "Ink", color: "#282c25", hex: "#282C25" },
                          { name: "Muted", color: "#878b80", hex: "#878B80" },
                          {
                            name: "Accent",
                            color: state.design.accent,
                            hex: state.design.accent.toUpperCase(),
                          },
                        ].map((c) => (
                          <div className="palette-item" key={c.name}>
                            <div
                              className="swatch"
                              style={{ background: c.color }}
                            >
                              {c.name === "Accent" && (
                                <Check size={21} color="white" />
                              )}
                            </div>
                            <strong>{c.name}</strong>
                            <span>{c.hex}</span>
                          </div>
                        ))}
                      </div>
                      <div className="accent-picker">
                        <div>
                          <span className="field-caption">
                            Accent direction
                          </span>
                          <strong>
                            {accents.find(
                              (a) => a.color === state.design.accent,
                            )?.name || "Custom color"}{" "}
                            <span>控えめな色で、意図を伝える。</span>
                          </strong>
                        </div>
                        <div className="accent-options">
                          {accents.map((a) => (
                            <button
                              key={a.color}
                              aria-label={`Accent ${a.name}`}
                              aria-pressed={state.design.accent === a.color}
                              title={a.name}
                              style={{ background: a.color }}
                              onClick={() => updateDesign({ accent: a.color })}
                            >
                              {state.design.accent === a.color && (
                                <Check size={13} />
                              )}
                            </button>
                          ))}
                          <label
                            className="custom-color"
                            title="カスタムカラー"
                          >
                            <Plus size={15} />
                            <input
                              type="color"
                              aria-label="Custom accent color"
                              value={state.design.accent}
                              onChange={(e) =>
                                updateDesign({ accent: e.target.value })
                              }
                            />
                          </label>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="property-editor">
                      {tab === "Typography" ? (
                        <>
                          <p
                            className="type-specimen"
                            style={{ fontSize: state.design.fontSize + 16 }}
                          >
                            Words give an interface its voice.
                          </p>
                          <Range
                            label="本文サイズ"
                            value={state.design.fontSize}
                            min={12}
                            max={18}
                            onChange={(fontSize) => updateDesign({ fontSize })}
                          />
                        </>
                      ) : tab === "Spacing" ? (
                        <Range
                          label="行の上下余白"
                          value={state.design.spacing}
                          min={8}
                          max={24}
                          onChange={(spacing) => updateDesign({ spacing })}
                        />
                      ) : tab === "Radius" ? (
                        <>
                          <div className="radius-samples">
                            {[0, 4, 6, 12, 20].map((r) => (
                              <button
                                key={r}
                                className={
                                  state.design.radius === r ? "selected" : ""
                                }
                                style={{ borderRadius: r }}
                                onClick={() => updateDesign({ radius: r })}
                              >
                                {r}px
                              </button>
                            ))}
                          </div>
                          <Range
                            label="面の角丸"
                            value={state.design.radius}
                            min={0}
                            max={20}
                            onChange={(radius) => updateDesign({ radius })}
                          />
                        </>
                      ) : (
                        <label className="toggle-row">
                          <span>
                            {tab === "Borders"
                              ? "一覧に区切り線を使う"
                              : "静的な面に影を使う"}
                            <small>
                              下の実画面で、情報のまとまり方を確かめてください。
                            </small>
                          </span>
                          <input
                            type="checkbox"
                            checked={
                              tab === "Borders"
                                ? state.design.border
                                : state.design.shadow
                            }
                            onChange={(e) =>
                              updateDesign(
                                tab === "Borders"
                                  ? { border: e.target.checked }
                                  : { shadow: e.target.checked },
                              )
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
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
              <>
                <div className="taste-progress">
                  <span>
                    QUESTION {String(questionIndex + 1).padStart(2, "0")} / 14
                  </span>
                  <div>
                    <i style={{ width: `${(answered / 14) * 100}%` }} />
                  </div>
                  <span>{answered} answered</span>
                </div>
                <div className="taste-heading">
                  <Pill>{questions[questionIndex].axis}</Pill>
                  <h2>{questions[questionIndex].title}</h2>
                  <p>正解はありません。直感に近いほうを選んでください。</p>
                </div>
                <div className="taste-options">
                  {(["a", "b"] as const).map((choice, i) => (
                    <button
                      className={`taste-card ${state.answers[questions[questionIndex].id] === choice ? "chosen" : ""}`}
                      key={choice}
                      onClick={() => answer(choice)}
                    >
                      <div
                        className={`taste-example taste-${questions[questionIndex].axis} option-${choice}`}
                      >
                        <div className="taste-example-title">
                          {questions[questionIndex].context}
                          <Plus size={14} />
                        </div>
                        {[
                          "Website redesign",
                          "Brand guidelines",
                          "Customer portal",
                        ].map((name, index) => (
                          <div className="taste-example-row" key={name}>
                            <span className="taste-symbol">{index + 1}</span>
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
                        <strong>{questions[questionIndex].labels[i]}</strong>
                        <ArrowUp size={16} />
                      </div>
                    </button>
                  ))}
                </div>
                <div className="taste-other">
                  {(
                    [
                      ["both", "どちらもよい"],
                      ["neither", "どちらも違う"],
                      ["skip", "スキップ"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      className="button"
                      onClick={() => answer(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="question-navigation">
                  <button
                    className="text-button"
                    disabled={questionIndex === 0}
                    onClick={() => setQuestionIndex((i) => i - 1)}
                  >
                    <ChevronLeft size={14} /> 前の比較
                  </button>
                  <span>選択は自動保存されます</span>
                  <button
                    className="text-button"
                    disabled={questionIndex === 13}
                    onClick={() => setQuestionIndex((i) => i + 1)}
                  >
                    次の比較 <ChevronRight size={14} />
                  </button>
                </div>
                {answered > 0 && (
                  <div className="dna-summary">
                    <h3>Your emerging taste</h3>
                    <p>
                      回答から見えてきた傾向。未回答の軸は、まだ決めません。
                    </p>
                    <div className="dna-bars">
                      {Object.entries(dna).map(([axis, value]) => (
                        <div key={axis}>
                          <span>{axis}</span>
                          <div>
                            <i style={{ width: `${(value ?? 0) * 100}%` }} />
                          </div>
                          <small>
                            {value === null ? "—" : value.toFixed(2)}
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
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
                <ComponentDemo name={component} design={state.design} />
                <div className="component-description">
                  <h2>Small pieces. One language.</h2>
                  <p>
                    同じアクセント、角丸、余白を共有します。Foundationの変更がここにも反映されます。
                  </p>
                  <div className="token-summary">
                    <Pill>radius · {state.design.radius}px</Pill>
                    <Pill>space · {state.design.spacing}px</Pill>
                    <Pill>accent · {state.design.accent}</Pill>
                  </div>
                </div>
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
                <p className="pattern-description">
                  {pattern === "EmptyState"
                    ? "情報がまだないときは、理由と次にできる操作を伝えます。"
                    : pattern === "FilterBar"
                      ? "検索と状態フィルタを、一覧のすぐ上にまとめます。"
                      : "見出し、操作、内容の順序を揃え、余白で情報のまとまりをつくります。"}
                </p>
                {pattern === "EmptyState" ? (
                  <div className="pattern-empty">
                    <Layers size={28} />
                    <h3>No projects yet</h3>
                    <p>最初のプロジェクトを作成して、仕事を整理しましょう。</p>
                    <button
                      className="button primary"
                      onClick={() => {
                        setScreen("list");
                        setPattern("ListPage");
                      }}
                    >
                      一覧の例を見る <ArrowRight size={14} />
                    </button>
                  </div>
                ) : (
                  <Preview design={state.design} screen={screen} />
                )}
              </>
            )}
            {current.id === "review" && (
              <>
                <div className="review-intro">
                  <ClipboardCheck size={35} strokeWidth={1.3} />
                  <h2>A second look, with your taste in mind.</h2>
                  <p>
                    いまの設定を、選んだ好みと照らし合わせます。
                    <br />
                    このモックでは設定値の簡易チェックのみを行います。
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setReviewed({ ...state.design })}
                  >
                    設定をチェック <ArrowRight size={15} />
                  </button>
                </div>
                {reviewed && (
                  <div className="review-results">
                    <div className="section-heading">
                      <h2>Check results</h2>
                      <Pill>
                        {JSON.stringify(reviewed) ===
                        JSON.stringify(state.design)
                          ? "Current settings"
                          : "設定が変更されています · 再チェックしてください"}
                      </Pill>
                    </div>
                    {[
                      {
                        title: "設定値の形式",
                        detail: "色・サイズ・余白は許可された範囲内です。",
                        pass: true,
                      },
                      {
                        title: "影の使用",
                        detail: reviewed.shadow
                          ? "静的な面に影を使っています。好みに合うか実画面で確認しましょう。"
                          : "静的な面には影を使っていません。",
                        pass: !reviewed.shadow,
                      },
                      {
                        title: "好みの回答",
                        detail: `${answered} / 14問に回答済み。未回答の軸を推測して補いません。`,
                        pass: answered === 14,
                      },
                    ].map((r) => (
                      <div className="review-row" key={r.title}>
                        {r.pass ? (
                          <Check size={19} />
                        ) : (
                          <CircleHelp size={19} />
                        )}
                        <div>
                          <h3>{r.title}</h3>
                          <p>{r.detail}</p>
                        </div>
                      </div>
                    ))}
                    <p className="muted">
                      AIによる見た目のレビューとアクセシビリティ監査は未実施です。
                    </p>
                  </div>
                )}
              </>
            )}
            {current.id === "export" && (
              <>
                <div className="export-banner">
                  <div>
                    <Code2 size={24} />
                    <h2>Your taste, written down.</h2>
                    <p>現在の設定と回答を、次の制作に持ち出せます。</p>
                  </div>
                  <Pill>Draft export</Pill>
                </div>
                <div className="export-actions">
                  <button
                    className="button primary"
                    onClick={() => {
                      download("DESIGN.md", markdown, "text/markdown");
                      setNotice("DESIGN.mdをダウンロードしました");
                    }}
                  >
                    <ArrowDownToLine size={15} /> DESIGN.md
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      download(
                        "design-system.json",
                        JSON.stringify(
                          {
                            schemaVersion: 1,
                            status: "mock-draft",
                            design: state.design,
                            taste: dna,
                            references: state.references.map(
                              ({ image: _image, ...r }) => r,
                            ),
                          },
                          null,
                          2,
                        ),
                        "application/json",
                      )
                    }
                  >
                    JSON
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      download(
                        "variables.css",
                        `:root {\n  --color-accent: ${state.design.accent};\n  --radius-md: ${state.design.radius}px;\n  --space-row: ${state.design.spacing}px;\n  --font-size-body: ${state.design.fontSize}px;\n  --row-border: ${state.design.border ? "1px solid #e9e9e3" : "none"};\n  --surface-shadow: ${state.design.shadow ? "0 5px 18px #22222213" : "none"};\n}\n`,
                        "text/css",
                      )
                    }
                  >
                    CSS variables
                  </button>
                </div>
                <div className="code-preview">
                  <div>
                    <span className="local-dot" /> DESIGN.md{" "}
                    <span>MARKDOWN</span>
                  </div>
                  <pre>{markdown}</pre>
                </div>
                <p className="muted export-note">
                  モック出力です。DTCG・React・PNG・ZIPの一括出力は次の実装段階で追加します。
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
                {connection.isError ? "APIに接続できません" : "Mock mode"}
                <span>Codex未接続</span>
              </div>
              <div className="conversation-content">
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
                    <small>Personal workspace</small>
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
                    モック提案を作成中…
                  </p>
                )}
                {proposal.isError && (
                  <p className="error-text" role="alert">
                    {proposal.error.message}
                  </p>
                )}
                {proposal.data && (
                  <div className="proposal" role="status">
                    <span className="context-label">MOCK PROPOSAL</span>
                    {proposal.data.supported ? (
                      <>
                        <p>{proposal.data.explanation}</p>
                        <div className="proposal-diff">
                          {Object.entries(proposal.data.design)
                            .filter(
                              ([k, v]) => state.design[k as keyof Design] !== v,
                            )
                            .map(([k, v]) => (
                              <div key={k}>
                                <span>{k}</span>
                                <del>
                                  {String(state.design[k as keyof Design])}
                                </del>
                                <ArrowRight size={11} />
                                <strong>{String(v)}</strong>
                              </div>
                            ))}
                        </div>
                        <small>プレビューに仮反映しています</small>
                        <div className="proposal-actions">
                          <button
                            className="button primary small"
                            onClick={() => {
                              if (proposal.data?.supported) {
                                updateDesign(proposal.data.design);
                                setNotice("提案を採用しました");
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
                      <p>{proposal.data.message}</p>
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
                <p>モック提案 · AIへの送信は行いません</p>
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
            { id: "desktop", Icon: Monitor, text: "Desktop" },
            { id: "tablet", Icon: Tablet, text: "Tablet" },
            { id: "mobile", Icon: Smartphone, text: "Mobile" },
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
        <Preview design={design} screen={screen} compact={width === "mobile"} />
      </div>
    </div>
  );
}
function ComponentDemo({ name, design }: { name: string; design: Design }) {
  const [dialog, setDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("Overview");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);
  const style = {
    "--preview-accent": design.accent,
    "--preview-radius": `${design.radius}px`,
  } as CSSProperties;
  return (
    <section className="component-demo" style={style}>
      <div className="section-label">
        <span>{name}</span>
        <span className="mono">INTERACTIVE SPECIMEN</span>
      </div>
      <div className="component-stage">
        {name === "Button" ? (
          <>
            <button
              className="sample-primary"
              onClick={(e) => {
                e.currentTarget.textContent = "Saved ✓";
              }}
            >
              Save changes
            </button>
            <button
              className="button"
              onClick={(e) => {
                e.currentTarget.textContent = "Confirmed ✓";
              }}
            >
              Secondary
            </button>
            <button
              className="text-button"
              onClick={(e) => {
                e.currentTarget.textContent = "Confirmed ✓";
              }}
            >
              Ghost <ArrowRight size={13} />
            </button>
            <button className="button" disabled>
              Disabled
            </button>
          </>
        ) : name === "Input" ? (
          <label className="demo-field">
            Project name
            <input placeholder="Website redesign" />
          </label>
        ) : name === "Select" ? (
          <label className="demo-field">
            Status
            <select>
              <option>In progress</option>
              <option>Planned</option>
              <option>Done</option>
            </select>
          </label>
        ) : name === "Checkbox" ? (
          <label className="sample-checkbox">
            <input type="checkbox" /> Receive project updates
          </label>
        ) : name === "Tabs" ? (
          <div>
            <div className="foundation-tabs">
              {["Overview", "Activity", "Settings"].map((t) => (
                <button
                  key={t}
                  aria-pressed={activeTab === t}
                  className={activeTab === t ? "active-tab" : ""}
                  onClick={() => setActiveTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <p>{activeTab} content</p>
          </div>
        ) : name === "Dialog" ? (
          <>
            <button className="sample-primary" onClick={() => setDialog(true)}>
              Open dialog
            </button>
            <dialog ref={dialogRef} onClose={() => setDialog(false)}>
              <h2>Save your changes?</h2>
              <p>このダイアログはコンポーネントの動作例です。</p>
              <button
                className="button primary"
                onClick={() => setDialog(false)}
              >
                確認して閉じる
              </button>
            </dialog>
          </>
        ) : name === "Badge" ? (
          <>
            <Pill>
              <span className="local-dot" /> In progress
            </Pill>
            <Pill>Planned</Pill>
            <Pill>
              <Check size={12} /> Done
            </Pill>
          </>
        ) : (
          <Preview design={design} />
        )}
      </div>
    </section>
  );
}
