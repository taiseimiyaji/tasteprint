import { expect, test, type Locator } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`keyboard navigation enters and leaves the conversation without losing the editor at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const name = `Keyboard workspace ${width}`;
    const created = await page.request.post("/api/projects", {
      data: { brief: { name }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const foundation = async () =>
      (
        await (
          await page.request.get(`/api/projects/${project.id}/foundation`)
        ).json()
      ).current;
    const saved = await foundation();
    let writes = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname.startsWith("/api/") &&
        request.method() !== "GET"
      )
        writes++;
    });
    // All UI actions use real keys; inspecting focus never moves it for the test.
    const tabTo = async (target: Locator, direction = "Tab", maximum = 80) => {
      await expect(target).toBeVisible();
      for (let count = 0; count <= maximum; count++) {
        if (await target.evaluate((el) => document.activeElement === el))
          return;
        if (count < maximum) await page.keyboard.press(direction);
      }
      await expect(target).toBeFocused();
    };
    await page.goto("/projects");
    await tabTo(page.getByRole("link", { name: `${name}を再開`, exact: true }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`/projects/${project.id}/overview$`),
    );
    const menu = page.getByRole("button", { name: "メニュー", exact: true });
    if (await menu.isVisible()) {
      await tabTo(menu);
      await page.keyboard.press("Enter");
    }
    await tabTo(
      page
        .getByRole("navigation", { name: "プロジェクトの設計" })
        .getByRole("link", { name: "Foundation", exact: true }),
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`/projects/${project.id}/foundation$`),
    );
    const toggle = page.getByRole("button", {
      name: "対話パネルを切り替え",
      exact: true,
    });
    const close = page.getByRole("button", {
      name: "対話パネルを閉じる",
      exact: true,
    });
    const panel = page.locator(".conversation");
    if (width === 1440) {
      await expect(panel).toBeVisible();
      // Automatic desktop visibility must not take focus from navigation.
      await expect(close).not.toBeFocused();
      await tabTo(toggle);
      await page.keyboard.press("Enter");
      await expect(toggle).toBeFocused();
    }
    await expect(panel).toHaveCount(0);
    const accent = page.getByRole("textbox", { name: "accent", exact: true });
    await tabTo(accent);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("#335577");
    await expect(accent).toHaveValue("#335577");
    await tabTo(toggle, "Shift+Tab", 10);
    await page.keyboard.press("Enter");
    await expect(close).toBeFocused();
    await expect(close).toBeInViewport();
    expect(
      await close.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
    ).toBe(true);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toHaveAttribute(
      "id",
      (await toggle.getAttribute("aria-controls")) || "",
    );
    const prompt = page.getByRole("textbox", {
      name: "デザインへのリクエスト",
      exact: true,
    });
    await tabTo(prompt, "Tab", 8);
    await page.keyboard.type("Keep this request draft");
    await tabTo(close, "Shift+Tab", 8);
    await page.keyboard.press("Space");
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await tabTo(accent, "Tab", 10);
    await expect(accent).toHaveValue("#335577");
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("#446688");
    await tabTo(toggle, "Shift+Tab", 10);
    await page.keyboard.press("Space");
    await expect(close).toBeFocused();
    await tabTo(prompt, "Tab", 8);
    await expect(prompt).toHaveValue("Keep this request draft");
    if (width === 1440) {
      // Responsive dismissal must not leave focus in a removed panel either.
      await page.setViewportSize({ width: 390, height: 900 });
      await expect(panel).toHaveCount(0);
      await expect(toggle).toBeFocused();
    } else {
      await tabTo(close, "Shift+Tab", 8);
      await page.keyboard.press("Enter");
      await tabTo(accent, "Tab", 10);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(panel).toHaveCount(0);
      await expect(accent).toBeFocused();
    }
    await tabTo(accent, "Tab", 10);
    await expect(accent).toHaveValue("#446688");
    expect(await foundation()).toEqual(saved);
    expect(writes).toBe(0);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
