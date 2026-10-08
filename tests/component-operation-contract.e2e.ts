import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { unzipSync } from "fflate";
for (const width of [1440, 390])
  for (const mode of ["workspace", "portable"])
    test(`${mode} saved operation contract ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const project = await (
        await page.request.post("/api/projects", {
          data: {
            brief: { name: `Operation contract ${mode} ${width}` },
            useTaste: false,
          },
        })
      ).json();
      const base = `/api/projects/${project.id}`;
      const original = (
        await (await page.request.get(base + "/foundation")).json()
      ).current;
      const design = {
        ...original.design,
        fontSize: 18,
        controlHeight: 48,
        components: {
          ...original.design.components,
          Input: { ...original.design.components.Input, size: "sm" },
          Button: { ...original.design.components.Button, size: "lg" },
        },
      };
      const savedResponse = await page.request.post(base + "/foundation/save", {
        data: {
          baseRevision: 1,
          design,
          reason: "Isolated operation contract fixture",
          requestId: crypto.randomUUID(),
        },
      });
      expect(savedResponse.ok()).toBe(true);
      const saved = await savedResponse.json();
      expect(saved.revision).toBe(2);
      const preview: any[] = [];
      await page.goto(`/projects/${project.id}/preview`);
      if (width === 390)
        await page
          .getByRole("button", { name: "Mobile 390px", exact: true })
          .click();
      const frame = page.frameLocator("iframe");
      for (const screen of ["Settings", "Form"]) {
        await page.getByRole("button", { name: screen, exact: true }).click();
        await expect(frame.locator(".sample-breadcrumb")).toHaveText(
          `Workspace / ${screen.toLowerCase()}`,
        );
        const inputs = frame.locator('input[data-component="Input"]');
        await expect(inputs.first()).toHaveCSS("font-size", "16px");
        await expect(inputs.first()).toHaveCSS("min-height", "40px");
        await inputs.first().fill("操作契約");
        await inputs
          .nth(1)
          .fill(screen === "Settings" ? "contract@example.com" : "説明");
        await frame
          .getByRole("combobox", { name: "Visibility" })
          .selectOption("Private");
        await inputs.first().press("Enter");
        await expect(
          frame.getByRole("button", { name: "Saved in preview", exact: true }),
        ).toBeVisible();
        preview.push({
          screen,
          filled: true,
          select: "Private",
          submitted: true,
        });
      }
      const exported = await page.request.post(base + "/exports", {
        data: { baseRevision: 2, bundle: true, imageMode: "omit" },
      });
      expect(exported.ok()).toBe(true);
      const record = await exported.json();
      expect(record.revision).toBe(2);
      expect(record.templateVersion).toBe("preview-13");
      const zipName = Object.keys(record.files).find((n) =>
        n.endsWith(".zip"),
      )!;
      const downloaded = await page.request.get(
        `${base}/exports/${record.id}/${zipName}`,
      );
      expect(downloaded.ok()).toBe(true);
      const entries = unzipSync(await downloaded.body());
      const designFile = Object.keys(entries).find((name) =>
        name.endsWith("/design-system.json"),
      )!;
      expect(
        JSON.parse(Buffer.from(entries[designFile]).toString()).design,
      ).toEqual(design);
      const dir = `test-results/operation-contract-${project.id}`;
      mkdirSync(dir, { recursive: true });
      for (const [name, bytes] of Object.entries(entries)) {
        const relative = name.split("/").slice(1).join("/");
        mkdirSync(`${dir}/${relative.split("/").slice(0, -1).join("/")}`, {
          recursive: true,
        });
        writeFileSync(`${dir}/${relative}`, bytes as Uint8Array);
      }
      const imports =
        mode === "portable"
          ? `import {Button,Input,Select,RuntimeTabs,RuntimeDialog,RuntimeTheme} from './ui';import {design} from './ui/design';import './ui/styles.css';`
          : `import {Button,Input,Select} from '/src/client/components/TemplateControls';import {RuntimeTabs,RuntimeDialog,RuntimeTheme} from '/src/client/design-runtime/Library';import {design} from './ui/design';import '/src/client/styles.css';`;
      writeFileSync(
        `${dir}/client.tsx`,
        `${imports}
import {useState} from 'react';import {createRoot} from 'react-dom/client';
function Instance({name,edge}:{name:string,edge:string}){const [open,setOpen]=useState(false),[submits,setSubmits]=useState(0),[view,setView]=useState('All projects');return <section data-instance={name}><form onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}}>
<label>Name<Input data-component="Input" name="name" required defaultValue="initial"/></label><label>Status<Select data-component="Select" name="status"><option>Planned</option><option>Done</option></Select></label><label>Locked<Input data-component="Input" name="locked" disabled defaultValue="locked"/></label><Button type="button" data-component="Button" disabled>Disabled save</Button><RuntimeTabs onChange={setView}/><output data-view>{view}</output><Button type="button" data-component="Button" onClick={()=>setOpen(true)}>Open confirmation</Button><Button type="submit" data-component="Button">Save form</Button><output data-submits>{submits}</output>
<RuntimeDialog open={open} close={()=>setOpen(false)}>{edge==='disabled'?<Button type="button" disabled tabIndex={0}>Disabled dialog action</Button>:<Button type="button" tabIndex={-1}>Programmatic dialog action</Button>}<label>Dialog note<Input data-component="Input" defaultValue="draft"/></label><label>Dialog choice<Select data-component="Select"><option>First</option><option>Second</option></Select></label></RuntimeDialog></form></section>}
createRoot(document.getElementById('root')!).render(<RuntimeTheme design={design}><main style={{width:"100%",minWidth:0,padding:16}}><label>Native choice<select aria-label="Native choice" data-component="Select"><option>Planned</option><option>Done</option></select></label><Instance name="first" edge="disabled"/><Instance name="second" edge="negative"/></main></RuntimeTheme>);document.documentElement.dataset.operationReady='true';`,
      );
      writeFileSync(
        `${dir}/index.html`,
        `<!doctype html><html lang="ja"><head><title>Operation consumer</title></head><body><div id="root"></div><script type="module" src="/${dir}/client.tsx"></script></body></html>`,
      );
      await page.goto(`/${dir}/index.html`);
      await expect(page.locator("html")).toHaveAttribute(
        "data-operation-ready",
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
      for (const [index, name] of ["first", "second"].entries()) {
        const section = page.locator(`[data-instance="${name}"]`);
        const input = section.getByLabel("Name", { exact: true });
        await expect(input).toHaveCSS("font-size", "16px");
        await expect(input).toHaveCSS("min-height", "40px");
        await input.fill(`日本語${name}`);
        const select = section.getByRole("combobox", {
          name: "Status",
          exact: true,
        });
        const native = page.getByRole("combobox", {
          name: "Native choice",
          exact: true,
        });
        await native.selectOption("Planned");
        await native.focus();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("End");
        await page.keyboard.press("Tab");
        const nativeKeyboardValue = await native.inputValue();
        await select.focus();
        await page.keyboard.press("ArrowDown");
        // Compare native platform selection behavior with a raw Select.
        await page.keyboard.press("End");
        await page.keyboard.press("Tab");
        await expect(select).toHaveValue(nativeKeyboardValue);
        await select.selectOption("Done");
        await expect(select).toHaveValue("Done");
        await expect(
          section.getByRole("tab", { name: "All projects" }),
        ).toBeFocused();
        await page.keyboard.press("End");
        await expect(
          section.getByRole("tab", { name: "Archived" }),
        ).toBeFocused();
        await expect(section.locator("[data-view]")).toHaveText("Archived");
        const other = page.locator(
          `[data-instance="${name === "first" ? "second" : "first"}"]`,
        );
        if (index === 0)
          await expect(other.locator("[data-view]")).toHaveText("All projects");
        const tabOwnership = await section
          .locator('[role="tab"]')
          .evaluateAll((tabs) =>
            tabs.every(
              (t) =>
                t.closest("section") ===
                document
                  .getElementById(t.getAttribute("aria-controls")!)
                  ?.closest("section"),
            ),
          );
        expect(tabOwnership).toBe(true);
        await expect(section.getByLabel("Locked")).toBeDisabled();
        await expect(
          section.getByRole("button", { name: "Disabled save", exact: true }),
        ).toBeDisabled();
        await expect(section.locator("[data-submits]")).toHaveText("0");
        await input.press("Enter");
        await expect(section.locator("[data-submits]")).toHaveText("1");
        const formData = await section
          .locator("form")
          .evaluate((f) =>
            Object.fromEntries(new FormData(f as HTMLFormElement)),
          );
        expect(formData.name).toBe(`日本語${name}`);
        expect(formData.locked).toBeUndefined();
        const trigger = section.getByRole("button", {
          name: "Open confirmation",
          exact: true,
        });
        await trigger.click();
        const dialog = section.locator("dialog");
        await expect(dialog).toBeVisible();
        const note = dialog.getByLabel("Dialog note");
        await note.fill(`保持${name}`);
        const titleOwned = await dialog.evaluate((d) =>
          d.contains(
            document.getElementById(d.getAttribute("aria-labelledby")!),
          ),
        );
        expect(titleOwned).toBe(true);
        await dialog
          .getByRole("button", { name: "Confirm", exact: true })
          .focus();
        await page.keyboard.press("Tab");
        const actual = await dialog.evaluate((d) => {
          const a = document.activeElement as HTMLElement;
          return {
            text: a.textContent,
            label: (a as HTMLInputElement).value,
            tag: a.tagName,
            tabIndex: a.tabIndex,
            disabled: (a as HTMLButtonElement).disabled,
            focusedNote: a === d.querySelector("input"),
          };
        });
        await expect(note).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(
          dialog.getByRole("button", { name: "Confirm", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(note).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(
          dialog.getByRole("combobox", { name: "Dialog choice", exact: true }),
        ).toBeFocused();
        cases.push({
          instance: name,
          edge: index === 0 ? "disabled-tabIndex0" : "button-tabIndex-1",
          tabOwnership,
          titleOwned,
          formData,
          nativeKeyboardValue,
          expectedFirst: "Dialog note",
          actual,
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        await expect(note).toHaveValue(`保持${name}`);
        await expect(section.locator("[data-submits]")).toHaveText("1");
      }
      expect(errors).toEqual([]);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
      mkdirSync("../evidence/component-operation-contract/fixed", {
        recursive: true,
      });
      writeFileSync(
        `../evidence/component-operation-contract/fixed/${mode}-${width}.json`,
        JSON.stringify(
          {
            mode,
            width,
            projectId: project.id,
            revision: 2,
            savedDesign: design,
            templateVersion: record.templateVersion,
            preview,
            cases,
            errors,
            realAiCalls: 0,
          },
          null,
          2,
        ),
      );
      expect(cases.map((c) => c.actual.focusedNote)).toEqual([true, true]);
    });
