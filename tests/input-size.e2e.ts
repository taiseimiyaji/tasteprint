import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { templateVersion } from "../src/server/exports/bundle";
for (const width of [1440, 390] as const)
  test(`saved Input size follows component height across specimens and screens at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.request.post("/api/projects", {
      data: { brief: { name: `Saved Input size ${width}` }, useTaste: false },
    });
    expect(response.ok()).toBe(true);
    const p = await response.json(),
      base = `/api/projects/${p.id}`;
    const original = (
      await (await page.request.get(`${base}/foundation`)).json()
    ).current;
    await page.goto(`/projects/${p.id}/foundation`);
    const frame = page.frameLocator("iframe");
    await expect(
      frame.getByRole("textbox", { name: "Search projects", exact: true }),
    ).toHaveCSS("min-height", `${original.design.controlHeight}px`);
    const defaultInput = frame.getByRole("textbox", {
      name: "Search projects",
      exact: true,
    });
    expect(
      await defaultInput.evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(original.design.controlHeight);
    await expect(defaultInput).toHaveCSS(
      "font-size",
      `${original.design.fontSize}px`,
    );
    await page.getByRole("tab", { name: "Spacing", exact: true }).click();
    await page
      .getByRole("spinbutton", { name: "controlHeight", exact: true })
      .fill("80");
    const save = async (revision: number) => {
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      await expect(
        page.getByText(new RegExp(`確定履歴（revision ${revision}`)),
      ).toBeVisible();
    };
    await save(2);
    await page.goto(`/projects/${p.id}/components`);
    await page.getByRole("button", { name: "Input", exact: true }).click();
    const specimen = frame.getByRole("textbox", {
        name: "Project name",
        exact: true,
      }),
      size = page.getByLabel("size", { exact: true });
    for (const [value, height, font, revision] of [
      ["sm", 72, 12, 3],
      ["md", 80, 14, 4],
      ["lg", 88, 16, 5],
    ] as const) {
      await size.selectOption(value);
      await expect(specimen).toHaveCSS("--component-height", `${height}px`);
      await expect(specimen).toHaveCSS("min-height", `${height}px`);
      await expect(specimen).toHaveCSS("font-size", `${font}px`);
      expect(
        await specimen.evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(height);
      await save(revision);
      const actual = (
        await (await page.request.get(`${base}/foundation`)).json()
      ).current;
      expect(actual.revision).toBe(revision);
      expect(actual.design.components.Input.size).toBe(value);
      expect(actual.design.controlHeight).toBe(80);
      expect(actual.design.components.Button).toEqual(
        original.design.components.Button,
      );
      expect(actual.design.components.Select).toEqual(
        original.design.components.Select,
      );
    }
    await page.reload();
    await page.getByRole("button", { name: "Input", exact: true }).click();
    await expect(size).toHaveValue("lg");
    await expect(specimen).toHaveCSS("min-height", "88px");
    const saved = (await (await page.request.get(`${base}/foundation`)).json())
      .current;
    expect(saved.design).toEqual({
      ...original.design,
      controlHeight: 80,
      components: {
        ...original.design.components,
        Input: { ...original.design.components.Input, size: "lg" },
      },
    });
    const history = (
      await (await page.request.get(`${base}/foundation`)).json()
    ).history;
    expect(history[0]).toEqual(original);
    await page.goto(`/projects/${p.id}/preview`);
    if (width === 390)
      await page
        .getByRole("button", { name: "Mobile 390px", exact: true })
        .click();
    await expect(frame.locator(".sample-app")).toHaveAttribute(
      "data-layout",
      width === 390 ? "compact" : "wide",
    );
    const screens = [];
    for (const screen of ["List", "Settings", "Form"]) {
      await page.getByRole("button", { name: screen, exact: true }).click();
      const inputs = frame.locator('input[data-component="Input"]:visible');
      await expect(inputs).toHaveCount(screen === "List" ? 1 : 2);
      for (const element of await inputs.all()) {
        await expect(element).toHaveCSS("min-height", "88px");
        expect(
          await element.evaluate((el) => el.getBoundingClientRect().height),
        ).toBe(88);
      }
      screens.push({ screen, height: 88, instances: await inputs.count() });
    }
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(
      frame.getByRole("button", { name: "New project", exact: true }),
    ).toHaveCSS("min-height", "80px");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      frame.locator('select[data-component="Select"]:visible').first(),
    ).toHaveCSS("min-height", "80px");
    await page.reload();
    if (width === 390)
      await page
        .getByRole("button", { name: "Mobile 390px", exact: true })
        .click();
    await expect(
      frame.getByRole("textbox", { name: "Search projects", exact: true }),
    ).toHaveCSS("min-height", "88px");
    const directory = "../evidence/input-size-ui";
    mkdirSync(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/saved-${width}.png`,
      fullPage: true,
    });
    const exported = await page.request.post(`${base}/exports`, {
      data: { baseRevision: 5, bundle: true, imageMode: "omit" },
    });
    expect(exported.ok()).toBe(true);
    const record = await exported.json();
    const zipName = record.binaryFiles.find((name: string) =>
      name.endsWith(".zip"),
    );
    const zipResponse = await page.request.get(
      `${base}/exports/${record.id}/${encodeURIComponent(zipName)}`,
    );
    expect(zipResponse.ok()).toBe(true);
    const entries = unzipSync(await zipResponse.body());
    const cssName = Object.keys(entries).find((name) =>
      name.endsWith("/ui/styles.css"),
    )!;
    expect(Buffer.from(entries[cssName]).toString()).toContain(
      '.sample-app.runtime-root input[data-component="Input"]',
    );
    expect(record.templateVersion).toBe(templateVersion);
    writeFileSync(
      `${directory}/${width}.json`,
      JSON.stringify(
        {
          width,
          revision: saved.revision,
          controlHeight: 80,
          size: "lg",
          screens,
          exportTemplateVersion: record.templateVersion,
          errors,
          actual_saved_design: saved.design,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
