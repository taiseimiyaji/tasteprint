import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { downloadExportConsumer } from "./export-consumer";

for (const width of [1440, 390])
  for (const mode of ["workspace", "portable"])
    test(`${mode} native Dialog links ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const { project, record, directory } = await downloadExportConsumer(page);
      expect(record.templateVersion).toBe("preview-14");
      const imports =
        mode === "portable"
          ? `import {Button,Input,RuntimeTheme,RuntimeDialog} from './ui';import './ui/styles.css';`
          : `import {Button,Input} from '/src/client/components/TemplateControls';import {RuntimeTheme,RuntimeDialog} from '/src/client/design-runtime/Library';import '/src/client/styles.css';`;
      writeFileSync(
        `${directory}/links.tsx`,
        `${imports}
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {design} from './ui/design';
function Consumer(){const [open,setOpen]=useState(false),[inner,setInner]=useState(false),[submits,setSubmits]=useState(0);return <RuntimeTheme design={design}><main><form onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}}>
<Button type="button" onClick={()=>setOpen(true)}>Open linked dialog</Button><output aria-label="Submit count">{submits}</output>
<RuntimeDialog open={open} close={()=>setOpen(false)}>
<a>No href</a><a href="#help" tabIndex={-1}>Programmatic link</a><Button type="button" disabled tabIndex={0}>Disabled action</Button>
<fieldset disabled><label>Disabled field<Input tabIndex={0}/></label><Button type="button" tabIndex={0}>Fieldset action</Button></fieldset>
<a href="#help">Read help</a><label>Dialog note<Input defaultValue="retained draft"/></label>
<fieldset disabled><a href="#help">Fieldset help</a></fieldset>
<Button type="button" onClick={()=>setInner(true)}>Open inner</Button>
<RuntimeDialog open={inner} close={()=>setInner(false)}><a href="#help">Inner help</a><label>Inner note<Input defaultValue="inner draft"/></label></RuntimeDialog>
</RuntimeDialog><p id="help">Local consumer help</p></form></main></RuntimeTheme>};createRoot(document.getElementById('root')!).render(<Consumer/>);document.documentElement.dataset.linksReady='true';`,
      );
      writeFileSync(
        `${directory}/links.html`,
        `<!doctype html><html><head><title>Native Dialog links</title></head><body><div id="root"></div><script type="module" src="/${directory}/links.tsx"></script></body></html>`,
      );
      await page.goto(`/${directory}/links.html`);
      await expect(page.locator("html")).toHaveAttribute(
        "data-links-ready",
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
      const trigger = page.getByRole("button", {
        name: "Open linked dialog",
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const outer = page.locator("dialog").first(),
        inner = page.locator("dialog").nth(1);
      const link = outer.getByRole("link", { name: "Read help", exact: true });
      const note = outer.getByLabel("Dialog note", { exact: true });
      const confirm = outer.getByRole("button", {
        name: "Confirm",
        exact: true,
      });
      const openInner = outer.getByRole("button", {
        name: "Open inner",
        exact: true,
      });
      await expect(outer).toBeVisible();
      // Opening focus follows native showModal; test sequential Tab boundaries explicitly.
      await confirm.focus();
      await page.keyboard.press("Tab");
      await expect(link).toBeFocused();
      await expect(outer.getByLabel("Disabled field")).toBeDisabled();
      await expect(
        outer.getByRole("button", { name: "Fieldset action", exact: true }),
      ).toBeDisabled();
      await expect(
        outer.getByRole("button", { name: "Disabled action", exact: true }),
      ).toBeDisabled();
      await expect(outer.locator("a").first()).not.toHaveAttribute("href");
      await expect(outer.locator("a").first()).not.toHaveAttribute("tabindex");
      expect(
        await outer
          .getByRole("link", { name: "Programmatic link" })
          .evaluate((a) => a.tabIndex),
      ).toBe(-1);
      const fieldsetLink = outer.getByRole("link", {
        name: "Fieldset help",
        exact: true,
      });
      expect(
        await fieldsetLink.evaluate((a) => ({
          tabIndex: a.tabIndex,
          disabled: a.matches(":disabled"),
        })),
      ).toEqual({ tabIndex: 0, disabled: false });
      await page.keyboard.press("Tab");
      await expect(note).toBeFocused();
      await note.fill("edited draft");
      await page.keyboard.press("Shift+Tab");
      await expect(link).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(link).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(note).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(fieldsetLink).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(openInner).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        outer.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(link).toBeFocused();

      await openInner.focus();
      await page.keyboard.press("Enter");
      await expect(inner).toBeVisible();
      const innerLink = inner.getByRole("link", {
        name: "Inner help",
        exact: true,
      });
      const innerNote = inner.getByLabel("Inner note");
      const innerConfirm = inner.getByRole("button", {
        name: "Confirm",
        exact: true,
      });
      await expect(innerLink).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(innerNote).toBeFocused();
      await innerNote.fill("edited inner draft");
      await page.keyboard.press("Shift+Tab");
      await expect(innerLink).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(innerConfirm).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(innerLink).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(inner).toBeHidden();
      await expect(outer).toBeVisible();
      await expect(openInner).toBeFocused();
      await expect(note).toHaveValue("edited draft");
      await expect(innerNote).toHaveValue("edited inner draft");
      // Closing the nested dialog must preserve the outer boundary as well.
      await confirm.focus();
      await page.keyboard.press("Tab");
      await expect(link).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(confirm).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(outer).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(note).toHaveValue("edited draft");
      await expect(page.getByLabel("Submit count")).toHaveText("0");
      expect(errors).toEqual([]);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
      mkdirSync("../evidence/dialog-native-links/fixed", { recursive: true });
      writeFileSync(
        `../evidence/dialog-native-links/fixed/${mode}-${width}.json`,
        JSON.stringify(
          {
            mode,
            width,
            projectId: project.id,
            templateVersion: record.templateVersion,
            forwardAndReverseLinkWrap: true,
            hrefLessAndNegativeExcluded: true,
            disabledFieldsetControlsExcluded: true,
            fieldsetLinkIncluded: true,
            nestedOwnershipAndRestoration: true,
            draftRetained: true,
            submissions: 0,
            errors,
            realAiCalls: 0,
            screenshots: 0,
          },
          null,
          2,
        ),
      );
    });
