import { useState } from "react";
import type { Design } from "../../domain/design";
import type { PatternName } from "../../domain/library";
import {
  Pattern,
  RuntimeTheme,
  RuntimeDialog,
  RuntimeTabs,
} from "../design-runtime/Library";
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
  pattern,
}: {
  design: Design;
  screen?: string;
  compact?: boolean;
  pattern?: PatternName;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("All projects"),
    [archived, setArchived] = useState(false);
  const [rows, setRows] = useState(previewRows),
    [open, setOpen] = useState(false),
    [name, setName] = useState("");
  const [saved, setSaved] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const filtered = rows.filter(
    (r) =>
      !archived &&
      r.name.toLowerCase().includes(search.toLowerCase()) &&
      (status === "All projects" || r.state === status),
  );
  const show = (slot: PatternName | "Table") =>
    !pattern || pattern === "ListPage" || pattern === slot;
  const empty = pattern === "EmptyState" || filtered.length === 0;
  return (
    <RuntimeTheme design={design}>
      {!compact && (
        <aside className="sample-sidebar">
          <strong>orbit</strong>
          <p>Workspace</p>
          <p>Projects</p>
          <p>Settings</p>
        </aside>
      )}
      <main className="sample-main">
        <div className="sample-breadcrumb">Workspace / {screen}</div>
        <Pattern
          design={design}
          className="sample-content"
          name={screen === "list" ? "ListPage" : undefined}
        >
          {show("PageHeader") && (
            <Pattern
              design={design}
              as="header"
              className="sample-heading"
              name="PageHeader"
              data-slot="PageHeader"
            >
              <div data-slot="title">
                <h3>
                  {screen === "list"
                    ? "Projects"
                    : screen === "settings"
                      ? "Workspace settings"
                      : "Create a project"}
                </h3>
                <p>A little structure. More room for good work.</p>
              </div>
              {screen === "list" && (
                <button
                  data-slot="action"
                  data-component="Button"
                  className="sample-primary"
                  onClick={() => setOpen(true)}
                >
                  New project
                </button>
              )}
            </Pattern>
          )}
          {screen === "list" ? (
            <>
              {show("FilterBar") && (
                <Pattern design={design} name="FilterBar" data-slot="FilterBar">
                  <div data-slot="tabs">
                    <RuntimeTabs
                      onChange={(v) => setArchived(v === "Archived")}
                    />
                  </div>
                  <label data-slot="search">
                    Search projects
                    <input
                      data-component="Input"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search projects..."
                    />
                  </label>
                  <label data-slot="filter">
                    Project status
                    <select
                      data-component="Select"
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
                </Pattern>
              )}
              {show("Table") && !empty && (
                <div className="sample-table-wrap" data-slot="Table">
                  <table data-component="Table">
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
                        <tr key={i}>
                          <td>
                            {r.name}
                            <small>{r.tag}</small>
                          </td>
                          <td>
                            <span data-component="Badge">{r.state}</span>
                          </td>
                          <td>{r.date}</td>
                          <td>{r.initials}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {show("EmptyState") && empty && (
                <Pattern
                  design={design}
                  as="section"
                  name="EmptyState"
                  data-slot="EmptyState"
                >
                  <p data-slot="message">
                    No projects found. Try another search.
                  </p>
                  <button
                    data-slot="action"
                    data-component="Button"
                    onClick={() => setOpen(true)}
                  >
                    Create a project
                  </button>
                </Pattern>
              )}
            </>
          ) : (
            <Pattern
              design={design}
              as="form"
              className="sample-settings"
              name={screen === "settings" ? "SettingsSection" : "FormSection"}
              onSubmit={(e) => {
                e.preventDefault();
                setLoading(true);
                setSaved(false);
                setTimeout(() => {
                  setLoading(false);
                  setSaved(true);
                }, 300);
              }}
              onChange={() => {
                setSaved(false);
                setError("");
              }}
              onInvalid={() =>
                setError("必須項目・メールアドレスを確認してください。")
              }
            >
              <div data-slot="fields" className="runtime-fields">
                <label>
                  {screen === "settings" ? "Workspace name" : "Project name"}
                  <input
                    data-component="Input"
                    required
                    aria-describedby="form-help"
                    defaultValue={screen === "settings" ? "Orbit Studio" : ""}
                  />
                </label>
                <label>
                  {screen === "settings" ? "Contact email" : "Description"}
                  <input
                    data-component="Input"
                    required
                    type={screen === "settings" ? "email" : "text"}
                    defaultValue={
                      screen === "settings" ? "hello@orbit.example" : ""
                    }
                  />
                </label>
                <label>
                  Visibility
                  <select data-component="Select">
                    <option>Workspace members</option>
                    <option>Private</option>
                  </select>
                </label>
                <label>
                  <input
                    data-component="Checkbox"
                    type="checkbox"
                    defaultChecked
                  />
                  Notify me about project updates
                </label>
                {error && <p role="alert">{error}</p>}
              </div>
              <button
                data-slot={screen === "settings" ? "save" : "submit"}
                data-component="Button"
                className="sample-primary"
                disabled={loading}
                aria-busy={loading}
              >
                {loading
                  ? "Saving…"
                  : saved
                    ? "Saved in preview"
                    : screen === "settings"
                      ? "Save changes"
                      : "Create project"}
              </button>
              <p data-slot="help" id="form-help">
                Required fields · Sample data stays in this preview
              </p>
              {screen === "settings" && (
                <section data-slot="danger" className="runtime-danger">
                  <h4>Danger zone</h4>
                  <p>通常の設定とは分けて、破壊的操作を確認します。</p>
                  <button
                    type="button"
                    data-component="Button"
                    onClick={() => setOpen(true)}
                  >
                    Delete workspace
                  </button>
                </section>
              )}
            </Pattern>
          )}
          <RuntimeDialog open={open} close={() => setOpen(false)}>
            {screen === "list" ? (
              <form
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
                  setOpen(false);
                }}
              >
                <label>
                  New project name
                  <input
                    data-component="Input"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button data-component="Button">Create</button>
              </form>
            ) : (
              <p>Preview only: no workspace will be deleted.</p>
            )}
          </RuntimeDialog>
        </Pattern>
      </main>
    </RuntimeTheme>
  );
}
