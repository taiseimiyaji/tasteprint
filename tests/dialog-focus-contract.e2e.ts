import { test, expect } from "@playwright/test";
import { downloadExportConsumer } from "./export-consumer";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
function domCycle(sequence: { key: string; inside: boolean }[]) {
  const keys = sequence.filter((f) => f.inside).map((f) => f.key);
  const cycle = [keys[0]];
  for (const key of keys.slice(1)) {
    if (key === keys[0]) break;
    cycle.push(key);
  }
  return cycle;
}
const scenarios = [
  "baseline",
  "inert-subtree",
  "visibility-override",
  "positive-order",
  "modal-escape",
];
for (const width of [1440, 390])
  for (const mode of ["workspace", "portable"])
    test(`${mode} native focus matrix ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const { project, record, directory } = await downloadExportConsumer(page);
      expect(record.templateVersion).toBe("preview-14");
      const imports =
        mode === "portable"
          ? `import {Button,Input,RuntimeTheme,RuntimeDialog} from './ui';import './ui/styles.css';`
          : `import {Button,Input} from '/src/client/components/TemplateControls';import {RuntimeTheme,RuntimeDialog} from '/src/client/design-runtime/Library';import '/src/client/styles.css';`;
      writeFileSync(
        `${directory}/matrix.tsx`,
        `${imports}
import {useState,useEffect,useRef,useId} from 'react';import {createRoot} from 'react-dom/client';import {design} from './ui/design';
function NativeDialog({open,close,children}){const ref=useRef(null),id=useId();useEffect(()=>{const d=ref.current;if(open&&!d.open)d.showModal();else if(!open&&d.open)d.close()},[open]);return <dialog ref={ref} aria-labelledby={id} onClose={e=>{if(e.target===e.currentTarget)close()}} onCancel={e=>{if(e.target===e.currentTarget)close()}}><h2 id={id}>Confirm changes</h2>{children}<button type="button" autoFocus onClick={close}>Cancel</button><button type="button" onClick={close}>Confirm</button></dialog>}
function Consumer({kind,scenario}){const [open,setOpen]=useState(false),[inner,setInner]=useState(false),[submits,setSubmits]=useState(0);const Dialog=kind==='native'?NativeDialog:RuntimeDialog,B=kind==='native'?'button':Button,I=kind==='native'?'input':Input;return <section data-kind={kind} data-scenario={scenario}><form onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}}>
<B type="button" onClick={()=>setOpen(true)}>Open outer</B><output aria-label="Submit count">{submits}</output>
<div inert={scenario==='modal-escape'?true:undefined}><Dialog open={open} close={()=>setOpen(false)}>
<a data-key="no-href">No href</a><a data-key="negative-link" href="#help" tabIndex={-1}>Negative link</a><B data-key="disabled-button" type="button" disabled tabIndex={0}>Disabled action</B><B data-key="negative-button" type="button" tabIndex={-1}>Negative button</B>
<fieldset disabled><label>Disabled field<I data-key="disabled-field" tabIndex={0}/></label><B data-key="disabled-fieldset-button" type="button" tabIndex={0}>Disabled fieldset action</B></fieldset>
{scenario==='inert-subtree'&&<div inert><a data-key="inert-link" href="#help">Inert link</a><I data-key="inert-input" tabIndex={0}/></div>}
{scenario==='visibility-override'&&<div style={{visibility:'hidden'}}><a data-key="hidden-link" href="#help">Hidden link</a><I data-key="hidden-input" tabIndex={0}/><a data-key="visible-override" href="#help" style={{visibility:'visible'}}>Visible override</a></div>}
{scenario==='positive-order'&&<><B type="button" data-key="positive-two" tabIndex={2}>Positive two</B><label>Positive one<I data-key="positive-one" tabIndex={1}/></label><a data-key="positive-two-link" href="#help" tabIndex={2}>Positive two link</a></>}
<a data-key="first-link" href="#help">Read help</a><label>Outer note<I data-key="note" defaultValue="outer draft"/></label><fieldset disabled><a data-key="fieldset-link" href="#help">Fieldset help</a></fieldset>
<B data-key="open-inner" type="button" onClick={()=>setInner(true)}>Open inner</B><Dialog open={inner} close={()=>setInner(false)}><a data-key="inner-link" href="#help">Inner help</a><label>Inner note<I data-key="inner-note" defaultValue="inner draft"/></label></Dialog>
</Dialog></div></form></section>}
createRoot(document.getElementById('root')).render(<RuntimeTheme design={design}><main>{${JSON.stringify(scenarios)}.flatMap(scenario=>['native','runtime'].map(kind=><Consumer key={scenario+kind} kind={kind} scenario={scenario}/>))}<p id="help">Local help</p></main></RuntimeTheme>);document.documentElement.dataset.matrixReady='true';`,
      );
      writeFileSync(
        `${directory}/matrix.html`,
        `<!doctype html><html><head><title>Native focus comparison</title></head><body><div id="root"></div><script type="module" src="/${directory}/matrix.tsx"></script></body></html>`,
      );
      await page.goto(`/${directory}/matrix.html`);
      await expect(page.locator("html")).toHaveAttribute(
        "data-matrix-ready",
        "true",
      );
      await expect(page.locator(".runtime-root")).toHaveCSS(
        "min-height",
        "800px",
      );
      await expect(page.locator(".runtime-root label").first()).toHaveCSS(
        "display",
        "flex",
      );
      const cases: any[] = [];
      for (const scenario of scenarios)
        for (const kind of ["native", "runtime"]) {
          const section = page.locator(
              `section[data-kind="${kind}"][data-scenario="${scenario}"]`,
            ),
            outer = section.locator("dialog").first(),
            inner = section.locator("dialog").nth(1);
          const trigger = section.getByRole("button", {
            name: "Open outer",
            exact: true,
          });
          await trigger.focus();
          await page.keyboard.press("Enter");
          await expect(outer).toBeVisible();
          const note = outer.getByLabel("Outer note", { exact: true });
          await note.fill(`retained ${scenario} ${kind}`);
          const confirm = outer.getByRole("button", {
            name: "Confirm",
            exact: true,
          });
          const focus = () =>
            outer.evaluate((d) => {
              const a = document.activeElement as HTMLElement;
              return {
                key:
                  a?.dataset.key ??
                  (a?.textContent === "Confirm"
                    ? "confirm"
                    : a?.textContent === "Cancel"
                      ? "cancel"
                      : a?.tagName),
                tag: a?.tagName,
                inside: d.contains(a),
                documentFocused: document.hasFocus(),
                tabIndex: a?.tabIndex,
              };
            });
          const states = await outer
            .locator("[data-key]")
            .evaluateAll((nodes) =>
              nodes.map((n) => {
                const e = n as HTMLElement;
                return {
                  key: e.dataset.key,
                  tabIndex: e.tabIndex,
                  disabled: e.matches(":disabled"),
                  inertAttributeAncestor: !!e.closest("[inert]"),
                  visibility: getComputedStyle(e).visibility,
                  rects: e.getClientRects().length,
                };
              }),
            );
          const walks: any = {};
          for (const [direction, key] of [
            ["forward", "Tab"],
            ["reverse", "Shift+Tab"],
          ]) {
            await confirm.focus();
            await expect(confirm).toBeFocused();
            const sequence = [await focus()];
            for (let i = 0; i < 16; i++) {
              await page.keyboard.press(key);
              sequence.push(await focus());
            }
            walks[direction] = sequence;
          }
          const edgeKeys = [
            "first-link",
            "note",
            "confirm",
            ...(scenario === "visibility-override" ? ["visible-override"] : []),
            ...(scenario === "positive-order"
              ? ["positive-one", "positive-two", "positive-two-link"]
              : []),
          ];
          const edges: any = {};
          for (const name of edgeKeys) {
            const control =
              name === "confirm"
                ? confirm
                : outer.locator(`[data-key="${name}"]`);
            for (const key of ["Tab", "Shift+Tab"]) {
              await control.focus();
              expect((await focus()).key).toBe(name);
              await page.keyboard.press(key);
              edges[`${name}:${key}`] = await focus();
            }
          }
          const excluded = [
            "no-href",
            "negative-link",
            "negative-button",
            "disabled-button",
            "disabled-field",
            "disabled-fieldset-button",
            "inert-link",
            "inert-input",
            "hidden-link",
            "hidden-input",
          ];
          const visited = Object.values(walks).flatMap((sequence: any) =>
            sequence.map((f: any) => f.key),
          );
          expect(
            visited.filter((key: string) => excluded.includes(key)),
          ).toEqual([]);
          const openInner = outer.getByRole("button", {
            name: "Open inner",
            exact: true,
          });
          await openInner.focus();
          await page.keyboard.press("Enter");
          await expect(inner).toBeVisible();
          const innerLink = inner.getByRole("link", {
              name: "Inner help",
              exact: true,
            }),
            innerConfirm = inner.getByRole("button", {
              name: "Confirm",
              exact: true,
            }),
            innerNote = inner.getByLabel("Inner note");
          await innerNote.fill("retained inner");
          await innerConfirm.focus();
          await page.keyboard.press("Tab");
          const nestedForward = await focus();
          await innerLink.focus();
          await page.keyboard.press("Shift+Tab");
          const nestedReverse = await focus();
          // Record raw native endpoints without imposing a custom in-DOM wrap policy.
          if (kind === "runtime") {
            await expect(innerConfirm).toBeFocused();
            expect(nestedForward.key).toBe("inner-link");
          }
          await page.keyboard.press("Escape");
          await expect(inner).toBeHidden();
          await expect(outer).toBeVisible();
          await expect(openInner).toBeFocused();
          await expect(innerNote).toHaveValue("retained inner");
          await expect(note).toHaveValue(`retained ${scenario} ${kind}`);
          await page.keyboard.press("Escape");
          await expect(outer).toBeHidden();
          await expect(trigger).toBeFocused();
          await expect(section.getByLabel("Submit count")).toHaveText("0");
          cases.push({
            scenario,
            kind,
            states,
            walks,
            edges,
            nested: {
              forward: nestedForward,
              reverse: nestedReverse,
              outerRemainsOpenAfterInnerEscape: true,
              restoresOpenInner: true,
              bothDraftsRetained: true,
            },
            excludedControlsNeverVisited: true,
            submissions: 0,
          });
        }
      expect(errors).toEqual([]);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
      const comparisons = scenarios.map((scenario) => {
        const native = cases.find(
            (c) => c.scenario === scenario && c.kind === "native",
          ),
          runtime = cases.find(
            (c) => c.scenario === scenario && c.kind === "runtime",
          );
        return {
          scenario,
          edgeDifferences: Object.keys(native.edges)
            .filter((k) => native.edges[k].key !== runtime.edges[k].key)
            .map((edge) => ({
              edge,
              native: native.edges[edge],
              runtime: runtime.edges[edge],
            })),
          nativeDomCycles: {
            forward: domCycle(native.walks.forward),
            reverse: domCycle(native.walks.reverse),
          },
          runtimeDomCycles: {
            forward: domCycle(runtime.walks.forward),
            reverse: domCycle(runtime.walks.reverse),
          },
          walksEqual: {
            forward:
              JSON.stringify(native.walks.forward.map((f: any) => f.key)) ===
              JSON.stringify(runtime.walks.forward.map((f: any) => f.key)),
            reverse:
              JSON.stringify(native.walks.reverse.map((f: any) => f.key)) ===
              JSON.stringify(runtime.walks.reverse.map((f: any) => f.key)),
          },
        };
      });
      for (const scenario of scenarios) {
        const native = cases.find(
            (c) => c.scenario === scenario && c.kind === "native",
          ),
          runtime = cases.find(
            (c) => c.scenario === scenario && c.kind === "runtime",
          );
        for (const direction of ["forward", "reverse"]) {
          const expected = domCycle(native.walks[direction]),
            actual = domCycle(runtime.walks[direction]);
          const required = [
            "confirm",
            "cancel",
            "first-link",
            "note",
            "fieldset-link",
            "open-inner",
            ...(scenario === "positive-order"
              ? ["positive-one", "positive-two", "positive-two-link"]
              : []),
            ...(scenario === "visibility-override" ? ["visible-override"] : []),
          ];
          expect(
            expected,
            `${scenario} ${direction} native control reaches targets`,
          ).toEqual(expect.arrayContaining(required));
          expect(actual, `${scenario} ${direction} native DOM cycle`).toEqual(
            expected,
          );
          expect(
            runtime.walks[direction].every(
              (focus: any) => focus.inside && focus.documentFocused,
            ),
          ).toBe(true);
        }
      }
      mkdirSync("../evidence/native-focus-contract/fixed", { recursive: true });
      writeFileSync(
        `../evidence/native-focus-contract/fixed/${mode}-${width}.json`,
        JSON.stringify(
          {
            base: "1462ce0e2d0989113ac0123861396d776cdc6ab7",
            mode,
            width,
            projectId: project.id,
            templateVersion: record.templateVersion,
            downloadedRuntimeSha256: createHash("sha256")
              .update(
                readFileSync(`${directory}/ui/design-runtime/Library.tsx`),
              )
              .digest("hex"),
            nativeHasNoTabKeyHandler: true,
            scenarios,
            tabPressesPerWalk: 16,
            cases,
            comparisons,
            errors,
            realAiCalls: 0,
            screenshots: 0,
          },
          null,
          2,
        ),
      );
    });
