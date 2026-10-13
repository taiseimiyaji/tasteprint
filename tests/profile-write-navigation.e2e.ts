import { test, expect } from "@playwright/test";

test("Profile keeps unsaved input on navigation when draft storage is full", async ({
  page,
}) => {
  await page.goto("/profile");
  const reason = page.getByLabel("density-0 理由", { exact: true });
  const original = await reason.inputValue();
  const changed = "保存先が満杯でも残す入力";
  await page.evaluate(() => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "tasteprint.profile.draft")
        throw new DOMException("fixture full", "QuotaExceededError");
      return native.call(this, key, value);
    };
  });
  await reason.fill(changed);
  await expect(
    page.locator(".editor-actions").getByRole("alert"),
  ).toContainText("下書きを保存できません");
  expect(
    await page.evaluate(() => localStorage.getItem("tasteprint.profile.draft")),
  ).not.toContain(changed);
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(reason).toHaveValue(changed);
  await expect(
    page.getByText("移動を中止しました", { exact: false }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "未保存の変更を取り消す", exact: true })
    .click();
  await expect(reason).toHaveValue(original);
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});

test("Profile can leave after saving its input to the server while draft storage remains full at 390", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1050 });
  await page.goto("/profile");
  const initial = (await (await page.request.get("/api/profile")).json())
    .current;
  const reason = page.getByLabel("density-0 理由", { exact: true });
  const input = "サーバーに保存した理由";
  await page.evaluate(() => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "tasteprint.profile.draft")
        throw new DOMException("fixture full", "QuotaExceededError");
      return native.call(this, key, value);
    };
  });
  await reason.fill(input);
  await expect(
    page.locator(".editor-actions").getByRole("alert"),
  ).toContainText("下書きを保存できません");
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  await menu.click();
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(reason).toHaveValue(input);

  await page
    .getByRole("button", { name: "共通の好みを保存", exact: true })
    .click();
  await expect(page.locator(".editor-actions")).toContainText(
    `共通 r${initial.revision + 1}`,
  );
  const saved = (await (await page.request.get("/api/profile")).json()).current;
  expect(saved.revision).toBe(initial.revision + 1);
  expect(saved.snapshot.reasons["density-0"]).toBe(input);
  if ((await menu.getAttribute("aria-expanded")) === "false")
    await menu.click();
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
