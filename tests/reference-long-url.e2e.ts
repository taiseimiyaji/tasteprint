import { expect, test } from "@playwright/test";
import { initialState } from "../src/client/state";

test("maximum saved Reference URL keeps mobile actions reachable and full URL editable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const suffix = crypto.randomUUID();
  const prefix = `https://example.invalid/${suffix}/`;
  const longUrl = prefix + "a".repeat(2048 - prefix.length);
  const referenceName = `Long URL reference ${suffix}`;
  expect(longUrl.length).toBe(2048);
  const base = "/api/projects/legacy/references";
  try {
    const imported = await page.request.post("/api/migration/browser", {
      data: {
        ...initialState,
        references: [
          {
            id: crypto.randomUUID(),
            name: referenceName,
            url: longUrl,
            aspects: ["Typography"],
          },
        ],
      },
    });
    expect(imported.ok()).toBe(true);
    const projectId = (await imported.json()).projectId as string;
    expect(projectId).toBe("legacy");
    await page.goto(`/projects/${projectId}/inspiration`);
    const card = page.locator(".reference-card").filter({ hasText: referenceName });
    await expect(card).toHaveCount(1);
    await expect(card.locator(".reference-url-preview")).toHaveText(longUrl);
    const field = card.getByRole("textbox", { name: "参考URL", exact: true });
    await expect(field).toHaveValue(longUrl);
    const metrics = await card.evaluate((element) => {
      const url = element.querySelector(".reference-url-preview")!;
      const rect = element.getBoundingClientRect();
      const save = Array.from(element.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("観点・メモを保存"),
      )!;
      return {
        viewport: innerWidth,
        page: document.documentElement.scrollWidth,
        cardRight: rect.right,
        urlHeight: url.getBoundingClientRect().height,
        saveOffset: save.getBoundingClientRect().top - rect.top,
        urlClient: url.clientWidth,
        urlScroll: url.scrollWidth,
      };
    });
    expect(metrics.page).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.cardRight).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.urlScroll).toBeLessThanOrEqual(metrics.urlClient + 1);
    expect(metrics.urlHeight).toBeLessThanOrEqual(40);
    expect(metrics.saveOffset).toBeLessThan(1500);
    const notes = card.getByRole("textbox", { name: "好きな点", exact: true });
    await notes.fill("長いURLの参考メモ");
    const save = card.getByRole("button", { name: "観点・メモを保存", exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await save.click();
    await expect(save).toBeDisabled();
    const saved = (await (await page.request.get(base)).json()).references.find(
      (reference: { name: string }) => reference.name === referenceName,
    );
    expect(saved.url).toBe(longUrl);
    expect(saved.likes).toBe("長いURLの参考メモ");
    await page.reload();
    await expect(field).toHaveValue(longUrl);
    await expect(notes).toHaveValue("長いURLの参考メモ");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await (await page.request.get("/api/health")).json()).codexCalls).toBe(0);
  } finally {
    const current = await page.request.get(base);
    if (current.ok()) {
      const reference = (await current.json()).references.find(
        (row: { name: string }) => row.name === referenceName,
      ) as { id: string; version: number } | undefined;
      if (reference)
        expect(
          (
            await page.request.delete(`${base}/${reference.id}`, {
              data: { version: reference.version },
            })
          ).ok(),
        ).toBe(true);
    }
  }
});
