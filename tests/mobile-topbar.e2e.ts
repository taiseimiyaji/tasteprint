import { test, expect } from "@playwright/test";

const steps = [
  ["inspiration", "Inspiration"],
  ["taste", "Taste"],
  ["foundation", "Foundation"],
  ["components", "Components"],
  ["patterns", "Patterns"],
  ["preview", "Preview"],
  ["review", "AI Review"],
  ["export", "Export"],
] as const;

for (const width of [320, 390]) {
  test(`workspace topbar keeps actions reachable at ${width}px`, async ({
    page,
  }) => {
    const created = await page.request.post("/api/projects", {
      data: { brief: { name: `Topbar ${width}` }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    await page.setViewportSize({ width, height: 720 });

    for (const [step, label] of steps) {
      await page.goto(`/projects/${project.id}/${step}`);
      const location = page.locator(".topbar-location");
      await expect(location.getByText(label, { exact: true })).toBeVisible();
      if (width === 320)
        await expect(location.locator(".topbar-prefix")).toBeHidden();
      else await expect(location.locator(".topbar-prefix")).toBeVisible();
      const topbar = page.locator(".topbar");
      await expect
        .poll(
          () =>
            topbar.evaluate(
              (header) => header.scrollWidth - header.clientWidth,
            ),
          { message: `${step} topbar width` },
        )
        .toBeLessThanOrEqual(0);
      if (step === "inspiration" || step === "foundation")
        await expect
          .poll(
            () => page.evaluate(() => document.documentElement.scrollWidth),
            { message: `${step} document width` },
          )
          .toBeLessThanOrEqual(width);
      const toggle = page.getByRole("button", {
        name: "対話パネルを切り替え",
      });
      await expect(toggle).toBeVisible();
      const box = await toggle.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }

    await page.goto(`/projects/${project.id}/foundation`);
    const toggle = page.getByRole("button", {
      name: "対話パネルを切り替え",
    });
    await toggle.click();
    await expect(page.locator(".conversation")).toBeVisible();
    await page.getByRole("button", { name: "対話パネルを閉じる" }).click();
    await expect(page.locator(".conversation")).toHaveCount(0);
    await page
      .locator(".topbar-actions")
      .getByRole("link", { name: "Export" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/export$`));
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
