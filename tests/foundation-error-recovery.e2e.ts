import { expect, test, type Locator } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`a named Foundation error recovery reaches the final field and supports keyboard correction at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const created = await page.request.post("/api/projects", {
      data: {
        brief: { name: `Foundation error target ${width}` },
        useTaste: false,
      },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const current = async () =>
      (
        await (
          await page.request.get(`/api/projects/${project.id}/foundation`)
        ).json()
      ).current;
    const initial = await current();
    let writes = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/") && r.method() !== "GET")
        writes++;
    });
    // Inspect focus without injecting it: every UI interaction is a real key.
    const tabTo = async (target: Locator, direction = "Tab", maximum = 80) => {
      await expect(target).toBeVisible();
      for (let n = 0; n <= maximum; n++) {
        if (await target.evaluate((el) => document.activeElement === el))
          return;
        if (n < maximum) await page.keyboard.press(direction);
      }
      await expect(target).toBeFocused();
    };
    await page.goto(`/projects/${project.id}/foundation`);
    const colors = page.getByRole("tab", { name: "Colors", exact: true });
    const typography = page.getByRole("tab", {
      name: "Typography",
      exact: true,
    });
    const input = page.getByRole("textbox", { name: "focus", exact: true });
    const save = page.getByRole("button", { name: "変更を保存", exact: true });
    await tabTo(input);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("unfinished-color");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    await tabTo(colors, "Shift+Tab");
    await page.keyboard.press("ArrowRight");
    await expect(typography).toBeFocused();
    await tabTo(
      page.getByRole("button", {
        name: "Colorsのフォーカスの色を修正",
        exact: true,
      }),
      "Tab",
      3,
    );
    await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#field-focus-label")).toBeInViewport({
      ratio: 1,
    });
    await expect(page.locator("#field-focus-error")).toBeInViewport({
      ratio: 1,
    });
    expect(
      await input.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
          el
        );
      }),
    ).toBe(true);
    await expect(input).toHaveValue("unfinished-color");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      /フォーカスの色.*6桁のカラーコード/,
    );
    await expect(save).toBeDisabled();
    await page.screenshot({
      path: test.info().outputPath("recovered-error.png"),
    });
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("#446688");
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator("#field-focus-error")).toHaveCount(0);
    await expect(save).toBeEnabled();
    // A later ordinary tab change must keep its own keyboard focus.
    await tabTo(colors, "Shift+Tab");
    await page.keyboard.press("ArrowRight");
    await expect(typography).toBeFocused();
    await page.keyboard.press("Home");
    await expect(colors).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("tabpanel", { name: "Colors", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("textbox", { name: "accent", exact: true }),
    ).toBeFocused();
    expect(writes).toBe(0);
    expect((await current()).revision).toBe(1);
    await tabTo(save, "Shift+Tab", 10);
    await page.keyboard.press("Enter");
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r2",
    );
    expect(writes).toBe(1);
    const saved = await current();
    expect(saved.revision).toBe(2);
    expect(saved.design).toEqual({ ...initial.design, focus: "#446688" });
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
