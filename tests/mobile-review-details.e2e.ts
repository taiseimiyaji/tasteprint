import { test, expect } from "@playwright/test";

for (const width of [320, 390]) {
  test(`expanded Review DNA stays in the viewport at ${width}px`, async ({
    page,
  }) => {
    const created = await page.request.post("/api/projects", {
      data: { brief: { name: `Review width ${width}` }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const reviewed = await page.request.post(
      `/api/projects/${project.id}/reviews`,
      { data: { baseRevision: 1 } },
    );
    expect(reviewed.ok()).toBe(true);
    const review = await reviewed.json();

    await page.setViewportSize({ width, height: 720 });
    await page.goto(`/projects/${project.id}/review`);
    await page.getByText("入力画像・DNA・関連ルール", { exact: true }).click();
    const dna = page.locator(".review-results details pre").first();
    await expect(dna).toBeVisible();
    expect(JSON.parse((await dna.textContent())!)).toEqual(review.dna);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
