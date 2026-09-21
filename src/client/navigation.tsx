import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ClipboardCheck,
  Fingerprint,
  FolderOpen,
  Image,
  Layers,
  LayoutTemplate,
  Menu,
  Monitor,
  SlidersHorizontal,
  X,
  FileText,
} from "lucide-react";
import type { Project } from "../server/projects/service";

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

/** The application frame stays mounted while the editing scope changes. */
export function AppShell({
  children,
  path,
  projects = [],
  ready = true,
}: {
  children: ReactNode;
  path: string;
  projects?: Project[];
  ready?: boolean;
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const parts = path.split("/");
  const projectId = parts[1] === "projects" ? parts[2] : undefined;
  const project = projects.find((p) => p.id === projectId);
  const inProfile = parts[1] === "profile";
  const currentStep = parts[3] || "overview";
  useEffect(() => {
    setMenuOpen(false);
  }, [path]);
  const closeMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      menuButton.current?.focus();
    }
  };
  const navLink = (
    to: string,
    name: string,
    Icon: typeof Fingerprint,
    active: boolean,
    hint?: string,
  ) => (
    <Link
      to={to as "/"}
      activeOptions={{ exact: true }}
      className={`nav-item ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={closeMenu}
      title={hint}
    >
      <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
      <span>{name}</span>
    </Link>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#app-content">
        本文へ移動
      </a>
      <aside
        className="sidebar app-sidebar"
        aria-label="サイドバー"
        onKeyDown={(e) => {
          if (e.key === "Escape") closeMenu();
        }}
      >
        <div className="sidebar-heading">
          <Link
            to={"/projects" as "/"}
            className="wordmark"
            aria-label="Tasteprint ホーム"
            onClick={closeMenu}
          >
            <Fingerprint size={30} strokeWidth={1.7} aria-hidden="true" />
            <span>
              tasteprint<span className="brand-dot">.</span>
            </span>
          </Link>
          <button
            className="button sidebar-toggle"
            ref={menuButton}
            aria-expanded={menuOpen}
            aria-controls="app-navigation"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />} メニュー
          </button>
        </div>
        <div
          id="app-navigation"
          className={`sidebar-navigation ${menuOpen ? "is-open" : ""}`}
        >
          <nav className="global-navigation" aria-label="アプリ全体">
            {navLink("/profile", "自分の好み", Fingerprint, inProfile)}
            {navLink(
              "/projects",
              "プロジェクト",
              FolderOpen,
              !inProfile && !projectId,
            )}
          </nav>
          <label className="project-switch">
            <span>プロジェクト切り替え</span>
            <select
              aria-label="プロジェクト切り替え"
              value={projectId || ""}
              disabled={!ready}
              onChange={(e) => {
                closeMenu();
                void navigate({
                  to: (e.target.value
                    ? `/projects/${e.target.value}/overview`
                    : "/profile") as "/",
                });
              }}
            >
              <option value="">共通の好み</option>
              {projectId && !project && (
                <option value={projectId}>プロジェクト</option>
              )}
              {projects
                .filter((p) => !p.archivedAt || p.id === projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.brief.name}
                    {p.archivedAt ? "（アーカイブ）" : ""}
                  </option>
                ))}
            </select>
          </label>
          {projectId ? (
            <>
              <div className="nav-label">このプロジェクト</div>
              <nav aria-label="プロジェクトの設計">
                {navLink(
                  `/projects/${projectId}/overview`,
                  "概要・設計方針",
                  FileText,
                  currentStep === "overview",
                )}
                {steps
                  .filter((s) => s.id !== "taste")
                  .map((s) => (
                    <div key={s.id}>
                      {navLink(
                        `/projects/${projectId}/${s.id}`,
                        s.name,
                        s.icon,
                        currentStep === s.id,
                        s.label,
                      )}
                    </div>
                  ))}
              </nav>
            </>
          ) : (
            <div className="sidebar-guidance">
              <span className="nav-label">YOUR DESIGN JOURNEY</span>
              <p>好みを集めて、プロジェクトごとの設計へ。</p>
              <p>
                Foundation・Preview・Exportは、プロジェクトを開いて進められます。
              </p>
            </div>
          )}
        </div>
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
      <div className="app-content" id="app-content" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
