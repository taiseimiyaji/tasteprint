import { test, expect } from "@playwright/test";

for (const width of [320, 390]) {
  test(`saved Taste stays readable without page overflow at ${width}px`, async ({
    page,
  }) => {
    const created = await page.request.post("/api/projects", {
      data: { brief: { name: `Taste width ${width}` }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const saved = (
      await (await page.request.get(`/api/projects/${project.id}`)).json()
    ).current.snapshot.taste;

    await page.setViewportSize({ width, height: 720 });
    await page.goto(`/projects/${project.id}/taste`);
    const snapshot = page.locator(".main-content > section pre");
    await expect(snapshot).toBeVisible();
    expect(JSON.parse((await snapshot.textContent())!)).toEqual(saved);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
