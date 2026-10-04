import { test, expect, type Page } from "@playwright/test";
type FixtureWindow = typeof window & {
  promptReadBlocked: boolean;
  promptWriteBlocked: boolean;
  storedPrompt: () => string | null;
  promptWrites: string[];
  cleanupAttempts: string[];
};
async function projectFor(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function promptStorage(page: Page, id: string, blocked = true) {
  await page.addInitScript(
    ({ key, blocked }) => {
      const state = window as FixtureWindow;
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      set.call(localStorage, key, "保存済みのリクエストを保持");
      state.promptReadBlocked = blocked;
      state.promptWriteBlocked = false;
      state.promptWrites = [];
      state.storedPrompt = () => get.call(localStorage, key);
      Storage.prototype.getItem = function (candidate) {
        if (candidate === key && state.promptReadBlocked)
          throw new DOMException("Prompt read denied", "SecurityError");
        return get.call(this, candidate);
      };
      Storage.prototype.setItem = function (candidate, value) {
        if (candidate === key) {
          state.promptWrites.push(value);
          if (state.promptWriteBlocked)
            throw new DOMException("Prompt write denied", "SecurityError");
        }
        return set.call(this, candidate, value);
      };
    },
    { key: `tasteprint.${id}.prompt`, blocked },
  );
}
async function noProjectUpdates(page: Page, id: string) {
  const conversations = await (
    await page.request.get(`/api/projects/${id}/conversations`)
  ).json();
  const foundation = await (
    await page.request.get(`/api/projects/${id}/foundation`)
  ).json();
  expect(conversations).toEqual([]);
  expect(foundation.current.revision).toBe(1);
}

test("prompt read failure keeps Workspace usable and the unread draft until explicit read recovery", async ({
  page,
}) => {
  const project = await projectFor(page, "Prompt read recovery");
  await promptStorage(page, project.id);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/projects/${project.id}/foundation`);
  await expect(
    page.getByRole("heading", { name: "Foundation.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "保存済みのリクエストを読み込めません",
  );
  await expect(
    page.getByRole("textbox", { name: "デザインへのリクエスト", exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(() => (window as FixtureWindow).storedPrompt()),
  ).toBe("保存済みのリクエストを保持");
  expect(
    await page.evaluate(() => (window as FixtureWindow).promptWrites),
  ).toEqual([]);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    if (width === 390) {
      await expect(page.locator(".workspace")).toHaveClass(/chat-closed/);
      await page
        .getByRole("button", { name: "対話パネルを切り替え", exact: true })
        .click();
    }
    const warning = page
      .getByRole("alert")
      .filter({ hasText: "保存済みのリクエストを読み込めません" });
    await expect(warning).toBeVisible();
    await warning.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    await page.screenshot({ path: `test-results/prompt-storage-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await noProjectUpdates(page, project.id);
  await page.evaluate(() => {
    (window as FixtureWindow).promptReadBlocked = false;
  });
  await page
    .getByRole("button", { name: "リクエスト下書きを再読込", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "デザインへのリクエスト", exact: true }),
  ).toHaveValue("保存済みのリクエストを保持");
  await expect(
    page.getByRole("button", { name: "リクエスト下書きを再読込", exact: true }),
  ).toHaveCount(0);
  await noProjectUpdates(page, project.id);
  expect(errors).toEqual([]);
});

test("explicit new prompt can replace an unread draft without sending an AI request", async ({
  page,
}) => {
  const project = await projectFor(page, "Prompt explicit replacement");
  await promptStorage(page, project.id);
  await page.goto(`/projects/${project.id}/foundation`);
  await expect(page.getByRole("alert")).toContainText(
    "保存済みのリクエストを読み込めません",
  );
  expect(
    await page.evaluate(() => (window as FixtureWindow).storedPrompt()),
  ).toBe("保存済みのリクエストを保持");
  await page
    .getByRole("textbox", { name: "デザインへのリクエスト", exact: true })
    .fill("新しく入力した内容");
  await expect(
    page.getByRole("button", { name: "リクエスト下書きを再読込", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as FixtureWindow).storedPrompt()),
  ).toBe("新しく入力した内容");
  await noProjectUpdates(page, project.id);
});

test("prompt write warning survives a successful design save and clears only after prompt retry", async ({
  page,
}) => {
  const project = await projectFor(page, "Prompt write isolation");
  await promptStorage(page, project.id, false);
  await page.goto(`/projects/${project.id}/foundation`);
  await expect(
    page.getByRole("textbox", { name: "デザインへのリクエスト", exact: true }),
  ).toHaveValue("保存済みのリクエストを保持");
  await page.evaluate(() => {
    (window as FixtureWindow).promptWriteBlocked = true;
  });
  await page
    .getByRole("textbox", { name: "デザインへのリクエスト", exact: true })
    .fill("保存を回復したい入力");
  const warning = page
    .getByRole("alert")
    .filter({ hasText: "リクエストの下書きを保存できません" });
  await expect(warning).toBeVisible();
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#224466");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.locator(".editor-actions")).toContainText(
    "保存済み · 設計 r2",
  );
  await expect(warning).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "デザインへのリクエスト", exact: true }),
  ).toHaveValue("保存を回復したい入力");
  expect(
    await page.evaluate(() => (window as FixtureWindow).storedPrompt()),
  ).toBe("保存済みのリクエストを保持");
  await page.evaluate(() => {
    (window as FixtureWindow).promptWriteBlocked = false;
  });
  await page
    .getByRole("button", { name: "リクエスト下書きを保存", exact: true })
    .click();
  await expect(warning).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as FixtureWindow).storedPrompt()),
  ).toBe("保存を回復したい入力");
  const foundation = await (
    await page.request.get(`/api/projects/${project.id}/foundation`)
  ).json();
  expect(foundation.current.revision).toBe(2);
  expect(foundation.current.design.accent).toBe("#224466");
});

for (const failedKey of [
  "tasteprint.new-project",
  "tasteprint.new-project.use-taste",
]) {
  test(`successful Project opens once when cleanup of ${failedKey} fails`, async ({
    page,
  }) => {
    await page.addInitScript((failedKey) => {
      const state = window as FixtureWindow;
      state.cleanupAttempts = [];
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith("tasteprint.new-project"))
          state.cleanupAttempts.push(key);
        if (key === failedKey)
          throw new DOMException("Cleanup denied", "SecurityError");
        return remove.call(this, key);
      };
    }, failedKey);
    await page.goto("/projects");
    await page
      .getByRole("button", { name: "新規プロジェクト", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const name = `Cleanup ${failedKey}`;
    await dialog.getByLabel("プロジェクト名", { exact: true }).fill(name);
    let creates = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/projects" &&
        request.method() === "POST"
      )
        creates++;
    });
    const reply = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/projects" &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "プロジェクトを作成", exact: true })
      .click();
    const response = await reply;
    expect(response.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const list = await (await page.request.get("/api/projects")).json();
    const created = list.filter(
      (p: { brief: { name: string } }) => p.brief.name === name,
    );
    expect(created).toHaveLength(1);
    await expect(page).toHaveURL(
      new RegExp(`/projects/${created[0].id}/overview$`),
    );
    const otherKey =
      failedKey === "tasteprint.new-project"
        ? "tasteprint.new-project.use-taste"
        : "tasteprint.new-project";
    expect(
      await page.evaluate((key) => localStorage.getItem(key), otherKey),
    ).toBeNull();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), failedKey),
    ).not.toBeNull();
    expect(creates).toBe(1);
    await page.reload();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(creates).toBe(1);
  });
}

test("failed Project creation preserves its browser draft and never runs cleanup", async ({
  page,
}) => {
  await page.goto("/projects");
  await page
    .getByRole("button", { name: "新規プロジェクト", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("プロジェクト名", { exact: true })
    .fill("Creation failure keeps draft");
  await page.evaluate(() => {
    const state = window as FixtureWindow;
    state.cleanupAttempts = [];
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      state.cleanupAttempts.push(key);
      return remove.call(this, key);
    };
  });
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 500,
        json: { message: "Creation failed" },
      });
    else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "プロジェクトを作成", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Creation failed");
  await expect(
    dialog.getByLabel("プロジェクト名", { exact: true }),
  ).toHaveValue("Creation failure keeps draft");
  expect(
    await page.evaluate(() => (window as FixtureWindow).cleanupAttempts),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("tasteprint.new-project")!).name,
    ),
  ).toBe("Creation failure keeps draft");
  const list = await (await page.request.get("/api/projects")).json();
  expect(
    list.some(
      (p: { brief: { name: string } }) =>
        p.brief.name === "Creation failure keeps draft",
    ),
  ).toBe(false);
});
