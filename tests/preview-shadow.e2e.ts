import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { defaultDesign } from "../src/domain/design";
import { reviewCapture } from "../src/server/review/capture";

for (const width of [1440, 390] as const) {
  test(`explicitly allowed surface shadows follow saved values and existing Review rules at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.request.post("/api/projects", {
      data: { brief: { name: "Saved shadow" }, useTaste: false },
    });
    expect(response.ok()).toBe(true);
    const p = await response.json();
    await page.goto(`/projects/${p.id}/foundation`);
    await page.getByRole("tab", { name: "Shadows", exact: true }).click();
    const root = page.frameLocator("iframe").locator(".sample-app");
    const table = page.frameLocator("iframe").locator(".sample-table-wrap");
    await expect(root).toHaveCSS("box-shadow", "none");
    await page.getByRole("checkbox", { name: "shadow", exact: true }).check();
    for (const [name, value] of [
      ["shadowX", "7"],
      ["shadowY", "11"],
      ["shadowBlur", "23"],
      ["shadowSpread", "2"],
      ["shadowOpacity", "0.4"],
    ])
      await page.getByRole("spinbutton", { name, exact: true }).fill(value);
    await page
      .getByRole("textbox", { name: "shadowColor", exact: true })
      .fill("#123456");
    const allowed = page.getByRole("textbox", {
      name: "shadowAllowed",
      exact: true,
    });
    expect(await allowed.inputValue()).toBe(defaultDesign.shadowAllowed);
    await expect(root).toHaveCSS("box-shadow", "none");
    await expect(table).toHaveCSS("box-shadow", "none");
    const expected = "rgba(18, 52, 86, 0.4) 7px 11px 23px 2px";
    for (const value of ["Preview", "Dialog, Preview", "Dialog、 Preview"]) {
      await allowed.fill(value);
      await expect(root).toHaveCSS("box-shadow", expected);
      await expect(table).toHaveCSS("box-shadow", expected);
    }
    for (const value of ["Preview面", "preview", "Dialog,Popover", ""]) {
      await allowed.fill(value);
      await expect(root).toHaveCSS("box-shadow", "none");
      await expect(table).toHaveCSS("box-shadow", "none");
    }
    await allowed.fill("Preview");
    await page.getByRole("checkbox", { name: "shadow", exact: true }).uncheck();
    await expect(root).toHaveCSS("box-shadow", "none");
    await expect(table).toHaveCSS("box-shadow", "none");
    await page.getByRole("checkbox", { name: "shadow", exact: true }).check();
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await expect(page.getByText(/確定履歴（revision 2/)).toBeVisible();
    const current = (
      await (await page.request.get(`/api/projects/${p.id}/foundation`)).json()
    ).current;
    expect(current.design).toEqual({
      ...defaultDesign,
      shadow: true,
      shadowAllowed: "Preview",
      shadowX: 7,
      shadowY: 11,
      shadowBlur: 23,
      shadowSpread: 2,
      shadowColor: "#123456",
      shadowOpacity: 0.4,
    });
    await page.goto(`/projects/${p.id}/preview`);
    if (width === 390)
      await page
        .getByRole("button", { name: "Mobile 390px", exact: true })
        .click();
    await expect(root).toHaveAttribute(
      "data-layout",
      width === 390 ? "compact" : "wide",
    );
    await expect(root).toHaveCSS("box-shadow", expected);
    await expect(table).toHaveCSS("box-shadow", expected);
    await page.reload();
    if (width === 390)
      await page
        .getByRole("button", { name: "Mobile 390px", exact: true })
        .click();
    await expect(root).toHaveAttribute(
      "data-layout",
      width === 390 ? "compact" : "wide",
    );
    await expect(root).toHaveCSS("box-shadow", expected);
    await expect(table).toHaveCSS("box-shadow", expected);
    const directory = "../evidence/preview-shadow-ui";
    mkdirSync(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/preview-${width}.png`,
      fullPage: false,
    });
    const original = (
      await (await page.request.get(`/api/projects/${p.id}/foundation`)).json()
    ).history.find((r: { revision: number }) => r.revision === 1);
    expect(original.design).toEqual(defaultDesign);
    if (width === 1440) {
      const result = await (
        await page.request.post(`/api/projects/${p.id}/reviews`, {
          data: { baseRevision: 2 },
        })
      ).json();
      expect(result.status).toBe("complete");
      expect(result.images).toHaveLength(3);
      expect(result.verifiedRules).toContain("shadow");
      expect(
        result.findings.filter(
          (finding: { ruleId: string }) => finding.ruleId === "shadow",
        ),
      ).toEqual([]);
      expect(result.design).toEqual(current.design);
      const capture = reviewCapture("http://127.0.0.1:3100");
      for (const design of [
        { ...current.design, shadow: false },
        { ...current.design, shadowAllowed: "Dialog, Popover" },
      ]) {
        const audit = await capture(design, "list", AbortSignal.timeout(20000));
        expect(
          audit.findings.filter((finding) => finding.ruleId === "shadow"),
        ).toEqual([]);
      }
    }
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
      { ...current.design, shadowAllowed: "Dialog\n Preview " },
    );
    await expect(page.locator(".sample-app")).toHaveCSS("box-shadow", expected);
    await expect(page.locator(".sample-table-wrap")).toHaveCSS(
      "box-shadow",
      expected,
    );
    writeFileSync(
      `${directory}/verified-${width}.json`,
      JSON.stringify(
        {
          projectId: p.id,
          revision: 2,
          expected,
          bothTargetsMatch: true,
          defaultAndFalseRemainNone: true,
          exactAllowlistRetained: true,
          originalRevisionUnchanged: true,
        },
        null,
        2,
      ),
    );
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
    expect(errors).toEqual([]);
  });
}
