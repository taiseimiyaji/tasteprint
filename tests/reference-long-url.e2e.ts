import { expect, test } from "@playwright/test";
import { initialState } from "../src/client/state";

test("maximum saved Reference URL keeps mobile actions reachable and full URL editable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const prefix = "https://example.invalid/";
  const longUrl = prefix + "a".repeat(2048 - prefix.length);
  expect(longUrl.length).toBe(2048);
  const imported = await page.request.post("/api/migration/browser", {
    data: {
      ...initialState,
      references: [
        {
          id: crypto.randomUUID(),
          name: "Long URL reference",
          url: longUrl,
          aspects: ["Typography"],
        },
      ],
    },
  });
  expect(imported.ok()).toBe(true);
  const projectId = (await imported.json()).projectId as string;
  const base = `/api/projects/${projectId}/references`;
  await page.goto(`/projects/${projectId}/inspiration`);
  const card = page.locator(".reference-card").filter({ hasText: "Long URL reference" });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".reference-url-preview")).toHaveText(longUrl);
  const field = card.getByRole("textbox", { name: "参考URL", exact: true });
  await expect(field).toHaveValue(longUrl);
  const metrics = await page.evaluate(() => {
    const card = document.querySelector(".reference-card")!;
    const url = card.querySelector(".reference-url-preview")!;
    const rect = card.getBoundingClientRect();
    const urlRect = url.getBoundingClientRect();
    const save = Array.from(card.querySelectorAll("button")).find((b) => b.textContent?.includes("観点・メモを保存"))!;
    return {
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      cardRight: rect.right,
      urlHeight: urlRect.height,
      saveTop: save.getBoundingClientRect().top + scrollY,
      urlClient: url.clientWidth,
      urlScroll: url.scrollWidth,
    };
  });
  expect(metrics.page).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.cardRight).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.urlScroll).toBeLessThanOrEqual(metrics.urlClient + 1);
  expect(metrics.urlHeight).toBeLessThanOrEqual(40);
  expect(metrics.saveTop).toBeLessThan(2300);
  const notes = card.getByRole("textbox", { name: "好きな点", exact: true });
  await notes.fill("長いURLの参考メモ");
  const save = card.getByRole("button", { name: "観点・メモを保存", exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.click();
  await expect(save).toBeDisabled();
  const saved = (await (await page.request.get(base)).json()).references[0];
  expect(saved.url).toBe(longUrl);
  expect(saved.likes).toBe("長いURLの参考メモ");
  await page.reload();
  await expect(field).toHaveValue(longUrl);
  await expect(notes).toHaveValue("長いURLの参考メモ");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await (await page.request.get("/api/health")).json()).codexCalls).toBe(0);
});
