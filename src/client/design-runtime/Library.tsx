import {
  Children,
  Fragment,
  isValidElement,
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Design } from "../../domain/design";
import {
  componentNames,
  patternNames,
  type ComponentName,
} from "../../domain/library";
import { designVariables } from "../../domain/tokens";
export function RuntimeTheme({
  design,
  children,
}: {
  design: Design;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1440);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const layout =
    width < design.compactBreakpoint
      ? "compact"
      : width < design.mediumBreakpoint
        ? "medium"
        : width < design.wideBreakpoint
          ? "regular"
          : "wide";
  // Every interpolated value is an enum or bounded number from designSchema.
  const css =
    componentNames
      .map((name) => {
        const c = design.components[name],
          size = design.controlHeight + { sm: -8, md: 0, lg: 8 }[c.size];
        const color =
          c.variant === "solid" ? "var(--color-surface)" : "var(--color-ink)";
        const background =
          c.variant === "solid"
            ? "var(--preview-accent)"
            : c.variant === "subtle"
              ? "var(--color-canvas)"
              : "var(--color-surface)";
        return `.sample-app [data-component="${name}"] {--component-height:${size}px; min-height:${size}px; font-size:${design.fontSize + { sm: -2, md: 0, lg: 2 }[c.size]}px; color:${color}; background:${background}; border:${c.variant === "subtle" ? 0 : 1}px solid var(--preview-accent); border-radius:var(--preview-radius); padding:4px 10px;}`;
      })
      .join("\n") +
    patternNames
      .map((name) => {
        const p = design.patterns[name];
        return (
          `.sample-app [data-pattern="${name}"] {display:flex; gap:${p.gap}px; ${["ListPage", "SettingsSection", "FormSection", "EmptyState"].includes(name) ? "flex-direction:column;" : ""}}` +
          `@media(max-width:${design.mediumBreakpoint - 1}px) {.sample-app [data-pattern="${name}"] {${p.responsive === "stack" ? "flex-direction:column;align-items:stretch;" : "flex-direction:row;flex-wrap:wrap;"}}}`
        );
      })
      .join("\n");
  return (
    <div
      ref={root}
      data-layout={layout}
      data-reduced-motion={design.reducedMotion}
      className="sample-app runtime-root"
      style={
        {
          ...designVariables(design),
          "--preview-accent": design.accent,
          "--preview-radius": `${design.radius}px`,
          "--preview-space": `${design.spacing}px`,
          "--preview-font": `${design.fontSize}px`,
          "--preview-border": design.border
            ? design.borderColor
            : "transparent",
        } as React.CSSProperties
      }
    >
      <style>{css}</style>
      {children}
    </div>
  );
}
export function RuntimeDialog({
  open,
  close,
  children,
}: {
  open: boolean;
  close: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-component="Dialog"
      aria-labelledby="dialog-title"
      onClose={close}
      onCancel={close}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const controls = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <h2 id="dialog-title">Confirm changes</h2>
      {children}
      <button data-component="Button" autoFocus onClick={close}>
        Cancel
      </button>
      <button data-component="Button" onClick={close}>
        Confirm
      </button>
    </dialog>
  );
}
export function RuntimeTabs({
  disabled = false,
  onChange,
}: {
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const tabs = ["All projects", "Archived"],
    [active, setActive] = useState(0);
  const select = (index: number) => {
    setActive(index);
    onChange?.(tabs[index]);
  };
  return (
    <div>
      <div role="tablist" aria-label="Project views">
        {tabs.map((name, i) => (
          <button
            key={name}
            id={`tab-${i}`}
            data-component="Tabs"
            role="tab"
            aria-selected={i === active}
            aria-controls="project-panel"
            tabIndex={i === active ? 0 : -1}
            disabled={disabled}
            onClick={() => select(i)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const next = e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - i;
              select(next);
              (
                e.currentTarget.parentElement?.children[next] as HTMLElement
              ).focus();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        id="project-panel"
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
      >
        {tabs[active]}
      </div>
    </div>
  );
}
export function ComponentSpecimen({
  design,
  name,
}: {
  design: Design;
  name: ComponentName;
}) {
  const [state, setState] = useState("default"),
    [open, setOpen] = useState(false);
  const config = design.components[name];
  useEffect(() => {
    if (!config.states.includes(state as never)) setState("default");
  }, [config, state]);
  const attrs = {
    "data-component": name,
    "data-state": state,
    disabled: state === "disabled",
    "aria-invalid": state === "error" || undefined,
    "aria-busy": state === "loading" || undefined,
  };
  return (
    <RuntimeTheme design={design}>
      <section className="runtime-specimen">
        <h2>{name}</h2>
        <p>{config.usage}</p>
        <label>
          表示状態
          <select
            aria-label="表示状態"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            {config.states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="specimen-control" data-state={state}>
          {name === "Button" ? (
            <button {...attrs}>
              {state === "loading" ? "Saving…" : "Save changes"}
            </button>
          ) : name === "Input" ? (
            <label>
              Project name
              <input {...attrs} placeholder="Website redesign" />
            </label>
          ) : name === "Select" ? (
            <label>
              Status
              <select {...attrs}>
                <option>In progress</option>
                <option>Done</option>
              </select>
            </label>
          ) : name === "Checkbox" ? (
            <label>
              <input type="checkbox" {...attrs} />
              Notify me
            </label>
          ) : name === "Tabs" ? (
            <RuntimeTabs disabled={state === "disabled"} />
          ) : name === "Dialog" ? (
            <>
              <button data-component="Button" onClick={() => setOpen(true)}>
                Open dialog
              </button>
              <RuntimeDialog open={open} close={() => setOpen(false)} />
            </>
          ) : name === "Table" ? (
            <table {...attrs}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Website redesign</td>
                  <td>In progress</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <span {...attrs}>In progress</span>
          )}
          {state === "error" && (
            <p role="alert">入力内容を確認してください。</p>
          )}
          {state === "loading" && <p role="status">Loading…</p>}
        </div>
        <p>利用ルール: {config.rules}</p>
        <p>根拠: {config.rationale}</p>
      </section>
    </RuntimeTheme>
  );
}

// Keep DOM, reading and keyboard order aligned with the saved structure.
export function Pattern({
  design,
  name,
  as = "div",
  children,
  ...props
}: {
  design: Design;
  name?: import("../../domain/library").PatternName;
  as?: "div" | "header" | "section" | "form";
} & React.HTMLAttributes<HTMLElement>) {
  const flatten = (nodes: ReactNode): ReactNode[] =>
    Children.toArray(nodes).flatMap((node) =>
      isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment
        ? flatten(node.props.children)
        : [node],
    );
  const slots = name ? design.patterns[name].structure : [];
  const position = (node: ReactNode) => {
    const slot = isValidElement<{ "data-slot"?: string }>(node)
      ? node.props["data-slot"]
      : undefined;
    const index = slots.indexOf(slot ?? "");
    return index < 0 ? slots.length : index;
  };
  return createElement(
    as,
    { ...props, "data-pattern": name },
    flatten(children).sort((a, b) => position(a) - position(b)),
  );
}
