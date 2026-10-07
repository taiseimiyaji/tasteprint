import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { downloadExportConsumer } from "./export-consumer";

const evidence = "../evidence/export-css-scope";
async function hostValues(page: Page) {
  return page.evaluate(() => {
    const css = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!);
    return {
      paper: css("html").getPropertyValue("--paper"),
      ink: css("html").getPropertyValue("--ink"),
      rootColor: css("html").color,
      bodyBackground: css("body").backgroundColor,
      workspaceDisplay: css("#host-workspace").display,
      inputWidth: document.querySelector("#host-title")!.getBoundingClientRect()
        .width,
      inputColor: css("#host-title").color,
      sameClassDisplay: css("#host-sample").display,
      sameClassFont: css("#host-sample").font,
      sameClassInputHeight: css("#host-sample input").minHeight,
      animationName: css("#host-spinner").animationName,
      motionDuration: css("#host-action").transitionDuration,
    };
  });
}

for (const width of [1440, 390]) {
  for (const motion of ["no-preference", "reduce"] as const) {
    test(`downloaded CSS preserves host and SPA exit at ${width}, ${motion}`, async ({
      page,
    }) => {
      mkdirSync(evidence, { recursive: true });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: motion });
      const { directory, record } = await downloadExportConsumer(page);
      writeFileSync(
        join(directory, "host.tsx"),
        `import {createRoot} from 'react-dom/client';
import {lazy,Suspense,useState} from 'react';
const Widgets=lazy(()=>import('./widgets.tsx'));
function Host(){const[show,setShow]=useState(false);return <><main id="host-workspace" className="workspace"><h1>Existing writing UI</h1><form onSubmit={e=>e.preventDefault()}><textarea id="host-title" aria-label="Host draft" defaultValue="Keep my draft"/><button id="host-action" type="button" onClick={()=>setShow(true)}>Load export</button><button type="button" onClick={()=>{history.pushState({},'', '/consumer-next');setShow(false)}}>Leave export</button></form><section className="sample-app" id="host-sample"><input data-component="Input" defaultValue="Host with same class"/></section><span id="host-spinner" className="spin">Host animation</span></main>{show&&<Suspense fallback={<p>Loading export</p>}><Widgets/></Suspense>}</>};
createRoot(document.getElementById('host-root')!).render(<Host/>);`,
      );
      writeFileSync(
        join(directory, "widgets.tsx"),
        `import{useState}from'react';import{RuntimeTheme,RuntimeTabs,RuntimeDialog,Input,Button}from'./ui';import{design}from'./ui/design';
export default function Widgets(){const[open,setOpen]=useState(false),[submits,setSubmits]=useState(0);return <><RuntimeTheme design={design}><form aria-label="Export form" onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}}><label>Export name<Input defaultValue="Export draft" data-component="Input"/></label><RuntimeTabs/><Button type="button" data-component="Button" onClick={()=>setOpen(true)}>Open export dialog</Button><RuntimeDialog open={open} close={()=>setOpen(false)}><label>Dialog draft<Input defaultValue="Modal draft"/></label><Button type="button" disabled>Disabled</Button></RuntimeDialog><Button type="submit">Submit export</Button><output aria-label="Export submits">{submits}</output></form></RuntimeTheme><RuntimeTheme design={{...design,controlHeight:58,fontSize:18}}><label>Second theme<Input data-component="Input" defaultValue="Independent theme"/></label></RuntimeTheme></>}`,
      );
      writeFileSync(
        join(directory, "host.html"),
        `<!doctype html><html lang="en"><head><title>Host boundary</title><style>
:root{--paper:#f6f5f0;--ink:#233a32;color:var(--ink);background:var(--paper)}body{margin:0;font:14px/1.7 Arial,sans-serif}*{box-sizing:border-box}.workspace{display:block;padding:16px}#host-workspace form{width:672px;max-width:100%}textarea{width:100%;color:var(--ink);font:inherit}#host-sample{display:block;font:12px Arial}#host-sample input{min-height:17px}button{transition:color .23s} .spin{animation:spin 7s linear infinite}@keyframes spin{to{opacity:.7}}
</style></head><body><div id="host-root"></div><script type="module" src="/${directory}/host.tsx"></script></body></html>`,
      );
      await page.goto(`/${directory}/host.html`);
      const draft = page.getByLabel("Host draft");
      await expect(draft).toBeVisible();
      const before = await hostValues(page);
      await draft.focus();
      await page
        .getByRole("button", { name: "Load export" })
        .evaluate((button) => (button as HTMLButtonElement).click());
      await expect(page.getByLabel("Export name")).toBeVisible();
      await expect(draft).toBeFocused();
      await expect(draft).toHaveValue("Keep my draft");
      const after = await hostValues(page);
      writeFileSync(
        join(evidence, `host-${width}-${motion}.json`),
        JSON.stringify(
          { templateVersion: record.templateVersion, before, after },
          null,
          2,
        ),
      );
      await page.screenshot({
        path: join(evidence, `host-${width}-${motion}.png`),
        fullPage: true,
      });
      expect(after).toEqual(before);
      const first = page.getByLabel("Export name"),
        second = page.getByLabel("Second theme");
      expect(
        await first.evaluate((el) => getComputedStyle(el).minHeight),
      ).not.toBe(await second.evaluate((el) => getComputedStyle(el).minHeight));
      const all = page.getByRole("tab", { name: "All projects" });
      await all.focus();
      await all.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Archived" })).toBeFocused();
      const opener = page.getByRole("button", { name: "Open export dialog" });
      await opener.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Dialog draft")).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(
        dialog.getByRole("button", { name: "Confirm", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByLabel("Dialog draft")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
      await expect(page.getByLabel("Export submits")).toHaveText("0");
      await page.getByRole("button", { name: "Submit export" }).click();
      await expect(page.getByLabel("Export submits")).toHaveText("1");
      await page.getByRole("button", { name: "Leave export" }).click();
      await expect(page.getByLabel("Export name")).toHaveCount(0);
      const afterExit = await hostValues(page);
      expect(afterExit).toEqual(before);
      writeFileSync(
        join(evidence, `host-${width}-${motion}.json`),
        JSON.stringify(
          { templateVersion: record.templateVersion, before, after, afterExit },
          null,
          2,
        ),
      );
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
  }

  test(`normal renderer and portable pages preserve appearance at ${width}`, async ({
    page,
  }) => {
    mkdirSync(evidence, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    const { directory, record } = await downloadExportConsumer(page);
    const design = JSON.parse(
      readFileSync(join(directory, "design-system.json"), "utf8"),
    ).design;
    writeFileSync(
      join(directory, "pages.tsx"),
      `import{createRoot}from'react-dom/client';import{ListPage,SettingsPage,FormPage}from'./ui';const screen=new URL(import.meta.url).searchParams.get('screen');const Screen=screen==='settings'?SettingsPage:screen==='form'?FormPage:ListPage;createRoot(document.getElementById('portable-root')!).render(<Screen/>);`,
    );
    for (const screen of ["list", "settings", "form"]) {
      await page.goto("/preview-render");
      await expect(page.locator("html")).toHaveAttribute(
        "data-renderer-ready",
        "true",
      );
      await page.evaluate(
        ({ design, screen }) =>
          window.postMessage(
            { type: "tasteprint-preview", design, screen },
            location.origin,
          ),
        { design, screen },
      );
      const root = page.locator(".sample-app");
      await expect(root).toBeVisible();
      await expect(root).toHaveCSS("--color-muted", design.muted);
      await page.evaluate(() => document.fonts.ready);
      const backdrop = await page
        .locator("html")
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      const normal = await root.screenshot();
      const path = join(evidence, `normal-${screen}-${width}.png`);
      if (process.env.SCOPE_BASELINE === "1") {
        writeFileSync(path, normal);
        continue;
      }
      if (process.env.SCOPE_COMPARE_BASELINE === "1")
        expect(normal.equals(readFileSync(path))).toBe(true);
      // Match the document language and the backdrop behind rounded corners;
      // both are owned by the consumer, not by the localized stylesheet.
      writeFileSync(
        join(directory, `pages-${screen}.html`),
        `<!doctype html><html lang="ja"><head><style>body{margin:0;background:${backdrop}}</style></head><body><div id="portable-root"></div><script type="module" src="/${directory}/pages.tsx?screen=${screen}"></script></body></html>`,
      );
      await page.goto(`/${directory}/pages-${screen}.html`);
      const portable = page.locator(".sample-app");
      await expect(portable).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const exported = await portable.screenshot();
      writeFileSync(
        join(evidence, `portable-${screen}-${width}.png`),
        exported,
      );
      expect(exported.equals(normal)).toBe(true);
    }
  });
}
