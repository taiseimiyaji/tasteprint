import { test, expect } from "@playwright/test";
import axe from "axe-core";
import { mkdirSync, writeFileSync } from "node:fs";
for (const width of [1440, 390]) {
  test(`saved user muted colors drive all category labels at ${width} and low contrast remains reportable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const response = await page.request.post("/api/projects", {
      data: { brief: { name: "User muted token" }, useTaste: false },
    });
    expect(response.ok()).toBe(true);
    const project = await response.json();
    const base = `/api/projects/${project.id}/foundation`;
    const original = (await (await page.request.get(base)).json()).current;
    let revision = 1;
    const observations = [];
    const dir = "../evidence/muted-category-ui";
    mkdirSync(dir, { recursive: true });
    for (const muted of ["#123456", "#aa0000"]) {
      await page.goto(`/projects/${project.id}/foundation`);
      await page.getByLabel("muted", { exact: true }).fill(muted);
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      revision++;
      await expect(page.locator(".editor-actions")).toContainText(
        `保存済み · 設計 r${revision}`,
      );
      const saved = (await (await page.request.get(base)).json()).current;
      expect(saved.revision).toBe(revision);
      expect(saved.design).toEqual({ ...original.design, muted });
      await page.goto(`/projects/${project.id}/preview`);
      await page
        .getByRole("button", {
          name: width === 390 ? "Mobile 390px" : "Desktop 1440px",
          exact: true,
        })
        .click();
      const labels = page
        .frameLocator('iframe[title="list Preview"]')
        .locator(".sample-app td:first-child small");
      await expect(
        page
          .frameLocator('iframe[title="list Preview"]')
          .locator(".sample-app"),
      ).toHaveAttribute("data-layout", width === 390 ? "compact" : "wide");
      await expect(labels).toHaveCount(5);
      const expected =
        muted === "#123456" ? "rgb(18, 52, 86)" : "rgb(170, 0, 0)";
      for (let i = 0; i < 5; i++)
        await expect(labels.nth(i)).toHaveCSS("color", expected);
      await expect(labels.first()).toHaveCSS("font-size", "8px");
      observations.push({
        revision,
        muted,
        actual: await labels.evaluateAll((nodes) =>
          nodes.map((el) => getComputedStyle(el).color),
        ),
      });
      await page.goto("/preview-render");
      await page.waitForSelector('html[data-renderer-ready="true"]', {
        state: "attached",
      });
      await page.evaluate(
        (design) =>
          window.postMessage(
            { type: "tasteprint-preview", design, screen: "list" },
            location.origin,
          ),
        saved.design,
      );
      await page.waitForSelector(".sample-app");
      await expect(page.locator(".sample-app")).toHaveAttribute(
        "data-layout",
        width === 390 ? "compact" : "wide",
      );
      await expect(
        page.locator(".sample-app td:first-child small").first(),
      ).toHaveCSS("color", expected);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${dir}/${width}-${muted.slice(1)}.png` });
    }
    const after = await (await page.request.get(base)).json();
    expect(
      after.history.find((r: { revision: number }) => r.revision === 1).design,
    ).toEqual(original.design);
    await page.evaluate(
      (design) =>
        window.postMessage(
          { type: "tasteprint-preview", design, screen: "list" },
          location.origin,
        ),
      { ...after.current.design, muted: "#878b80" },
    );
    await expect(
      page.locator(".sample-app td:first-child small").first(),
    ).toHaveCSS("color", "rgb(135, 139, 128)");
    await page.addScriptTag({ content: axe.source });
    const audit = await page.evaluate(async () =>
      (window as unknown as { axe: typeof axe }).axe.run(".sample-app", {
        runOnly: ["color-contrast"],
      }),
    );
    const categories = audit.violations
      .flatMap((v) => v.nodes)
      .filter((n) =>
        n.target.some((target) =>
          String(target).includes("td:nth-child(1) > small"),
        ),
      );
    expect(categories).toHaveLength(5);
    writeFileSync(
      `${dir}/verified-${width}.json`,
      JSON.stringify(
        { observations, lowContrastCategories: categories },
        null,
        2,
      ),
    );
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
