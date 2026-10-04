import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { defaultDesign } from "../src/domain/design";
import sharp from "sharp";

for (const width of [1440, 390]) {
  test(`saved Table row height follows rowHeight and size independently of controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const created = await page.request.post("/api/projects", {
      data: { brief: { name: "Saved Table row height" }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const p = await created.json(),
      base = `/api/projects/${p.id}`;
    const original = (
      await (await page.request.get(`${base}/foundation`)).json()
    ).current;
    await page.goto(`/projects/${p.id}/foundation`);
    await page.getByRole("tab", { name: "Spacing", exact: true }).click();
    const frame = page.frameLocator("iframe"),
      cell = frame.locator('table[data-component="Table"] td').first();
    const assertRow = async (height: number) => {
      await expect(cell).toHaveCSS("--component-height", `${height}px`);
      await expect(cell).toHaveCSS("height", `${height}px`);
      expect(
        await cell.evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(height);
    };
    const assertControls = async (height: number) => {
      await expect(
        frame.getByRole("button", { name: "New project", exact: true }),
      ).toHaveCSS("min-height", `${height}px`);
      await expect(
        frame.getByRole("textbox", { name: "Search projects", exact: true }),
      ).toHaveCSS("min-height", `${height}px`);
    };
    const save = async (revision: number) => {
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      await expect(
        page.getByText(new RegExp(`確定履歴（revision ${revision}`)),
      ).toBeVisible();
    };
    await assertRow(defaultDesign.rowHeight);
    await assertControls(defaultDesign.controlHeight);
    const rowHeight = page.getByRole("spinbutton", {
      name: "rowHeight",
      exact: true,
    });
    await rowHeight.fill("80");
    await save(2);
    await assertRow(80);
    await assertControls(36);
    await rowHeight.fill("120");
    await save(3);
    await assertRow(120);
    await assertControls(36);
    await page
      .getByRole("spinbutton", { name: "controlHeight", exact: true })
      .fill("100");
    await save(4);
    await assertRow(120);
    await assertControls(100);
    await page.goto(`/projects/${p.id}/components`);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await assertRow(120);
    const size = page.getByLabel("size", { exact: true });
    for (const [value, height] of [
      ["sm", 112],
      ["md", 120],
      ["lg", 128],
    ] as const) {
      await size.selectOption(value);
      await assertRow(height);
    }
    await save(5);
    await page.reload();
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(size).toHaveValue("lg");
    await assertRow(128);
    const saved = (await (await page.request.get(`${base}/foundation`)).json())
      .current;
    expect(saved.design).toEqual({
      ...defaultDesign,
      rowHeight: 120,
      controlHeight: 100,
      components: {
        ...defaultDesign.components,
        Table: { ...defaultDesign.components.Table, size: "lg" },
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
    await assertRow(128);
    await assertControls(100);
    await cell.scrollIntoViewIfNeeded();
    const directory = "../evidence/table-height-ui";
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/preview-${width}.png` });
    if (width === 1440) {
      const response = await page.request.post(`${base}/reviews`, {
        data: { baseRevision: 5 },
      });
      expect(response.ok()).toBe(true);
      const review = await response.json();
      expect(review.status).toBe("complete");
      expect(review.images).toHaveLength(3);
      expect(review.design).toEqual(saved.design);
      expect(review.scope).toContainEqual(
        expect.stringContaining("viewport 1440×1000"),
      );
      expect(review.scope).toContainEqual(
        expect.stringContaining("全ページPNG"),
      );
      const png = await page.request.get(
        `${base}/reviews/images/${review.images[0]}`,
      );
      expect(png.ok()).toBe(true);
      const image = await png.body();
      const dimensions = await sharp(image).metadata();
      expect(dimensions.width).toBe(1440);
      expect(dimensions.height).toBeGreaterThan(1000);
      writeFileSync(`${directory}/review-list.png`, image);
    }
    expect(errors).toEqual([]);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
