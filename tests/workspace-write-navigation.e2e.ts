import { test, expect } from "@playwright/test";

async function prepared(page: import("@playwright/test").Page, width: number) {
  await page.setViewportSize({ width, height: 1050 });
  const created = await page.request.post("/api/projects", {
    data: {
      brief: { name: `Workspace draft write ${width}` },
      useTaste: false,
    },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const key = `tasteprint.scope.${project.id}.draft.v1`;
  await page.goto(`/projects/${project.id}/foundation`);
  const accent = page.getByRole("textbox", { name: "accent", exact: true });
  const original = await accent.inputValue();
  await expect
    .poll(() =>
      page.evaluate((draftKey) => localStorage.getItem(draftKey), key),
    )
    .not.toBeNull();
  await page.evaluate((draftKey) => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === draftKey)
        throw new DOMException("fixture full", "QuotaExceededError");
      return native.call(this, name, value);
    };
  }, key);
  const changed = original === "#123abc" ? "#654321" : "#123abc";
  await accent.fill(changed);
  await expect(
    page.locator(".editor-actions").getByRole("alert"),
  ).toContainText("下書きを保存できません");
  expect(
    await page.evaluate((draftKey) => localStorage.getItem(draftKey), key),
  ).not.toContain(changed);
  return { project, key, accent, original, changed };
}

async function projectsLink(
  page: import("@playwright/test").Page,
  width: number,
) {
  if (width === 390) {
    const menu = page.getByRole("button", { name: "メニュー", exact: true });
    if ((await menu.getAttribute("aria-expanded")) === "false")
      await menu.click();
  }
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
}

test("Workspace retains an unpersisted design on desktop navigation until discard", async ({
  page,
}) => {
  const { project, accent, original, changed } = await prepared(page, 1440);
  await projectsLink(page, 1440);
  await expect(page).toHaveURL(
    new RegExp(`/projects/${project.id}/foundation$`),
  );
  await expect(accent).toHaveValue(changed);
  await expect(
    page.getByText("移動を中止しました", { exact: false }),
  ).toBeVisible();
  const dialogEvent = page.waitForEvent("dialog");
  const reload = page.reload({ timeout: 2000 }).catch(() => undefined);
  const dialog = await dialogEvent;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reload;
  await expect(accent).toHaveValue(changed);
  await page
    .locator("nav")
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/export$`));
  await page
    .locator("nav")
    .getByRole("link", { name: "Foundation", exact: true })
    .click();
  await expect(accent).toHaveValue(changed);
  await page
    .getByRole("button", { name: "未保存の変更を取り消す", exact: true })
    .click();
  await expect(accent).toHaveValue(original);
  await projectsLink(page, 1440);
  await expect(page).toHaveURL(/\/projects$/);
  expect(
    (
      await (
        await page.request.get(`/api/projects/${project.id}/foundation`)
      ).json()
    ).current.revision,
  ).toBe(1);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});

test("Workspace permits mobile navigation after server save while storage remains full", async ({
  page,
}) => {
  const { project, changed } = await prepared(page, 390);
  await projectsLink(page, 390);
  await expect(page).toHaveURL(
    new RegExp(`/projects/${project.id}/foundation$`),
  );
  await expect(
    page.getByRole("textbox", { name: "accent", exact: true }),
  ).toHaveValue(changed);
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  const saved = (
    await (
      await page.request.get(`/api/projects/${project.id}/foundation`)
    ).json()
  ).current;
  expect(saved.design.accent).toBe(changed);
  await projectsLink(page, 390);
  await expect(page).toHaveURL(/\/projects$/);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
