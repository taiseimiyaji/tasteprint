import { useState, type CSSProperties } from "react";
import {
  ArrowUpRight,
  Search,
  Plus,
  ChevronDown,
  Check,
  Layers,
  LayoutDashboard,
  Settings2,
  CircleHelp,
} from "lucide-react";
import type { Design } from "../../domain/design";
export const previewRows = [
  {
    name: "Website redesign",
    tag: "Design",
    state: "In progress",
    date: "Sep 24",
    initials: "AK",
    color: "#e5c6af",
  },
  {
    name: "Brand guidelines",
    tag: "Brand",
    state: "In review",
    date: "Sep 28",
    initials: "MS",
    color: "#d3d9c3",
  },
  {
    name: "Customer portal",
    tag: "Product",
    state: "In progress",
    date: "Oct 02",
    initials: "YT",
    color: "#c5d3df",
  },
  {
    name: "Onboarding flow",
    tag: "Product",
    state: "Planned",
    date: "Oct 08",
    initials: "AK",
    color: "#e5c6af",
  },
  {
    name: "Design library",
    tag: "Design",
    state: "Done",
    date: "Oct 12",
    initials: "MS",
    color: "#d3d9c3",
  },
];
export function Preview({
  design,
  screen = "list",
  compact = false,
}: {
  design: Design;
  screen?: string;
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All projects");
  const [formOpen, setFormOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rows, setRows] = useState(previewRows);
  const [name, setName] = useState("");
  const style = {
    "--preview-accent": design.accent,
    "--preview-radius": `${design.radius}px`,
    "--preview-space": `${design.spacing}px`,
    "--preview-font": `${design.fontSize}px`,
    "--preview-border": design.border ? "#e9e9e3" : "transparent",
    "--preview-shadow": design.shadow ? "0 5px 18px #22222213" : "none",
  } as CSSProperties;
  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) &&
      (status === "All projects" || r.state === status),
  );
  return (
    <div
      className={`sample-app ${compact ? "sample-compact" : ""}`}
      style={style}
    >
      <aside className="sample-sidebar">
        <div className="sample-brand">
          <span className="sample-logo">o</span> orbit <ChevronDown size={12} />
        </div>
        <span className="sample-menu-label">WORKSPACE</span>
        <div>
          <LayoutDashboard size={14} /> Overview
        </div>
        <div className="selected">
          <Layers size={14} /> Projects <small>{rows.length}</small>
        </div>
        <div>
          <Settings2 size={14} /> Settings
        </div>
        <span className="sample-sidebar-bottom">
          <CircleHelp size={14} /> Help & resources
        </span>
      </aside>
      <div className="sample-main">
        <div className="sample-breadcrumb">
          Workspace <span>/</span>{" "}
          {screen === "list"
            ? "Projects"
            : screen === "settings"
              ? "Settings"
              : "New project"}{" "}
          <span className="sample-user">AK</span>
        </div>
        <div className="sample-content">
          <div className="sample-heading">
            <div>
              <span className="sample-eyebrow">YOUR WORK, IN ONE PLACE</span>
              <h3>
                {screen === "list"
                  ? "Projects"
                  : screen === "settings"
                    ? "Workspace settings"
                    : "Create a project"}
              </h3>
              <p>
                {screen === "list"
                  ? "A little structure. More room for good work."
                  : "Make this space work for you."}
              </p>
            </div>
            {screen === "list" && (
              <button
                className="sample-primary"
                onClick={() => setFormOpen(!formOpen)}
              >
                <Plus size={13} /> New project
              </button>
            )}
          </div>
          {screen === "list" ? (
            <>
              {formOpen && (
                <form
                  className="sample-inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!name.trim()) return;
                    setRows([
                      ...rows,
                      {
                        name: name.trim(),
                        tag: "Design",
                        state: "Planned",
                        date: "Oct 15",
                        initials: "AK",
                        color: "#e5c6af",
                      },
                    ]);
                    setName("");
                    setFormOpen(false);
                  }}
                >
                  <input
                    aria-label="New project name"
                    placeholder="Project name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                  <button className="sample-primary">Create</button>
                </form>
              )}
              <div className="sample-tools">
                <div className="sample-tabs">
                  <b>
                    All projects <small>{rows.length}</small>
                  </b>
                  <span>Archived</span>
                </div>
                <div className="sample-search">
                  <Search size={13} />
                  <input
                    aria-label="Search projects"
                    placeholder="Search projects..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="sample-filter">
                <span>
                  <span className="status-dot" /> {filtered.length} projects
                </span>
                <label>
                  <span className="sr-only">Project status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {[
                      "All projects",
                      "In progress",
                      "In review",
                      "Planned",
                      "Done",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="sample-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Project name</th>
                      <th>Status</th>
                      <th>Due date</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr key={`${r.name}-${i}`}>
                        <td>
                          <span className="project-icon">
                            <Layers size={13} />
                          </span>
                          <span>
                            {r.name}
                            <small>{r.tag}</small>
                          </span>
                        </td>
                        <td>
                          <span
                            className={`sample-status ${r.state === "Done" ? "done" : ""}`}
                          >
                            <i />
                            {r.state}
                          </span>
                        </td>
                        <td>{r.date}</td>
                        <td>
                          <span
                            className="avatar"
                            style={{ background: r.color }}
                          >
                            {r.initials}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty-state">
                    No projects found. Try another search.
                  </div>
                )}
              </div>
              <div className="sample-footer">
                Showing {filtered.length} of {rows.length} projects{" "}
                <span>
                  Made for a calmer workday <ArrowUpRight size={11} />
                </span>
              </div>
            </>
          ) : (
            <form
              className="sample-settings"
              onSubmit={(e) => {
                e.preventDefault();
                setSaved(true);
              }}
              onChange={() => setSaved(false)}
            >
              <label>
                {screen === "settings" ? "Workspace name" : "Project name"}
                <input
                  required
                  defaultValue={screen === "settings" ? "Orbit Studio" : ""}
                  placeholder="e.g. Website redesign"
                />
              </label>
              <label>
                {screen === "settings" ? "Contact email" : "Description"}
                <input
                  required
                  type={screen === "settings" ? "email" : "text"}
                  defaultValue={
                    screen === "settings" ? "hello@orbit.example" : ""
                  }
                  placeholder="What are we working on?"
                />
              </label>
              <label>
                Visibility
                <select>
                  <option>Workspace members</option>
                  <option>Private</option>
                </select>
              </label>
              <label className="sample-checkbox">
                <input type="checkbox" defaultChecked /> Notify me about project
                updates
              </label>
              <button className="sample-primary">
                {saved ? (
                  <>
                    <Check size={14} /> Saved in preview
                  </>
                ) : screen === "settings" ? (
                  "Save changes"
                ) : (
                  "Create project"
                )}
              </button>
              <p className="sample-form-note">
                Sample data · changes stay in this preview
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
