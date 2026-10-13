import { test, expect, type Page } from "@playwright/test";

async function project(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function denyWrite(page: Page, key: string) {
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), key))
    .not.toBeNull();
  await page.evaluate((k) => {
    const fixture = window as typeof window & { draftWriteBlocked: boolean };
    fixture.draftWriteBlocked = true;
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === k && fixture.draftWriteBlocked)
        throw new DOMException("fixture full", "QuotaExceededError");
      return native.call(this, name, value);
    };
  }, key);
}

test("new project keeps an unwritten name until server creation", async ({
  page,
}) => {
  await page.goto("/projects");
  await page
    .getByRole("button", { name: "新規プロジェクト", exact: true })
    .click();
  const name = page.getByLabel("プロジェクト名", { exact: true });
  await denyWrite(page, "tasteprint.new-project");
  await name.fill("保持する新規プロジェクト名");
  await expect(
    page.getByRole("alert").filter({ hasText: "下書きを保存できません" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("link", { name: "自分の好み", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByText("移動を中止しました", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "新規プロジェクト", exact: true })
    .click();
  await expect(name).toHaveValue("保持する新規プロジェクト名");
  await page
    .getByRole("button", { name: "プロジェクトを作成", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/overview$/);
  const projects = await (await page.request.get("/api/projects")).json();
  expect(
    projects.filter(
      (project: { brief: { name: string } }) =>
        project.brief.name === "保持する新規プロジェクト名",
    ),
  ).toHaveLength(1);
});

test("new project choice stays on screen until its browser write can be retried", async ({
  page,
}) => {
  await page.goto("/projects");
  await page
    .getByRole("button", { name: "新規プロジェクト", exact: true })
    .click();
  await denyWrite(page, "tasteprint.new-project.use-taste");
  const useTaste = page.getByLabel("共通の好みを使う", { exact: true });
  await useTaste.uncheck();
  await expect(
    page.getByRole("alert").filter({ hasText: "下書きを保存できません" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("link", { name: "自分の好み", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByText("移動を中止しました", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "新規プロジェクト", exact: true })
    .click();
  await expect(useTaste).not.toBeChecked();
  await page.evaluate(() => {
    (
      window as typeof window & { draftWriteBlocked: boolean }
    ).draftWriteBlocked = false;
  });
  await page
    .getByRole("button", { name: "下書きの保存を再試行", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "下書きを保存できません" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("link", { name: "自分の好み", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await page
    .getByRole("button", { name: "新規プロジェクト", exact: true })
    .click();
  await expect(useTaste).not.toBeChecked();
});

test("Overview blocks a failed draft write and releases after explicit discard", async ({
  page,
}) => {
  const p = await project(page, "Overview quota baseline");
  await page.goto(`/projects/${p.id}/overview`);
  const purpose = page.getByLabel("用途", { exact: true });
  const original = await purpose.inputValue();
  await denyWrite(page, `tasteprint.${p.id}.overview`);
  await purpose.fill("保持する用途");
  await expect(
    page.getByRole("alert").filter({ hasText: "下書きを保存できません" }),
  ).toBeVisible();
  await page
    .locator("nav")
    .getByRole("link", { name: "Foundation", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/overview$`));
  await expect(purpose).toHaveValue("保持する用途");
  await expect(
    page.getByText("移動を中止しました", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "未保存の変更を取り消す", exact: true })
    .click();
  await expect(purpose).toHaveValue(original);
  await page
    .locator("nav")
    .getByRole("link", { name: "Foundation", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/foundation$`));
  expect(
    (await (await page.request.get(`/api/projects/${p.id}/foundation`)).json())
      .current.revision,
  ).toBe(1);
});

test("Reference card keeps an unwritten note until server save", async ({
  page,
}) => {
  const p = await project(page, "Reference quota baseline");
  const base = `/api/projects/${p.id}/references`;
  const response = await page.request.post(base, {
    data: {
      name: "Quota reference",
      url: "",
      selections: [{ aspect: "Typography", intent: "reference" }],
      likes: "",
      dislikes: "",
    },
  });
  expect(response.ok()).toBe(true);
  const ref = await response.json();
  await page.goto(`/projects/${p.id}/inspiration`);
  const card = page
    .locator(".reference-card")
    .filter({ hasText: "Quota reference" });
  const likes = card.getByRole("textbox", { name: "好きな点", exact: true });
  await expect(likes).toHaveValue("");
  await denyWrite(page, `tasteprint.${p.id}.reference.${ref.id}`);
  await likes.fill("保持する参考メモ");
  await expect(
    card.getByRole("alert").filter({ hasText: "下書きを保存できません" }),
  ).toBeVisible();
  await page
    .locator("nav")
    .getByRole("link", { name: "Foundation", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/inspiration$`));
  await expect(likes).toHaveValue("保持する参考メモ");
  await expect(
    card.getByText("移動を中止しました", { exact: false }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "観点・メモを保存", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(base)).json()).references.find(
          (r: any) => r.id === ref.id,
        ).likes,
    )
    .toBe("保持する参考メモ");
  await page
    .locator("nav")
    .getByRole("link", { name: "Foundation", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/foundation$`));
  const saved = (await (await page.request.get(base)).json()).references.find(
    (r: any) => r.id === ref.id,
  );
  expect(saved.likes).toBe("保持する参考メモ");
});

test("Unsent request blocks project exit and can leave after browser retry", async ({
  page,
}) => {
  const p = await project(page, "Prompt quota baseline");
  await page.goto(`/projects/${p.id}/foundation`);
  const key = `tasteprint.${p.id}.prompt`;
  const prompt = page.getByRole("textbox", {
    name: "デザインへのリクエスト",
    exact: true,
  });
  await expect(prompt).toHaveValue("");
  await denyWrite(page, key);
  await prompt.fill("保持する未送信リクエスト");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "リクエストの下書きを保存できません" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/foundation$`));
  await expect(prompt).toHaveValue("保持する未送信リクエスト");
  await expect(
    page.getByText("移動を中止しました", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    (
      window as typeof window & { draftWriteBlocked: boolean }
    ).draftWriteBlocked = false;
  });
  await page
    .getByRole("button", { name: "リクエスト下書きを保存", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "リクエストの下書きを保存できません" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(`/projects/${p.id}/foundation`);
  await expect(prompt).toHaveValue("保持する未送信リクエスト");
  expect(
    await (
      await page.request.get(`/api/projects/${p.id}/conversations`)
    ).json(),
  ).toEqual([]);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});

for (const editedAfterRecovery of [false, true] as const) {
  test(`request reread with a failed rewrite ${editedAfterRecovery ? "protects a new edit" : "allows exit without a new edit"}`, async ({
    page,
  }) => {
    const p = await project(page, "Prompt read recovery and failed rewrite");
    const key = `tasteprint.${p.id}.prompt`;
    const savedPrompt = "保存済みのリクエスト";
    await page.addInitScript(
      ({ key, savedPrompt }) => {
        const fixture = window as typeof window & {
          promptReadBlocked: boolean;
        };
        const get = Storage.prototype.getItem;
        const set = Storage.prototype.setItem;
        set.call(localStorage, key, savedPrompt);
        fixture.promptReadBlocked = true;
        Storage.prototype.getItem = function (candidate) {
          if (candidate === key && fixture.promptReadBlocked)
            throw new DOMException("fixture read denied", "SecurityError");
          return get.call(this, candidate);
        };
        Storage.prototype.setItem = function (candidate, value) {
          if (candidate === key)
            throw new DOMException("fixture full", "QuotaExceededError");
          return set.call(this, candidate, value);
        };
      },
      { key, savedPrompt },
    );
    await page.goto(`/projects/${p.id}/foundation`);
    const prompt = page.getByRole("textbox", {
      name: "デザインへのリクエスト",
      exact: true,
    });
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "保存済みのリクエストを読み込めません" }),
    ).toBeVisible();
    await page.evaluate(() => {
      (
        window as typeof window & { promptReadBlocked: boolean }
      ).promptReadBlocked = false;
    });
    await page
      .getByRole("button", { name: "リクエスト下書きを再読込", exact: true })
      .click();
    await expect(prompt).toHaveValue(savedPrompt);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "リクエストの下書きを保存できません" }),
    ).toBeVisible();
    if (editedAfterRecovery)
      await prompt.fill("再読込後に書いた新しいリクエスト");
    await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
    if (editedAfterRecovery) {
      await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/foundation$`));
      await expect(prompt).toHaveValue("再読込後に書いた新しいリクエスト");
      await expect(
        page.getByText("移動を中止しました", { exact: false }),
      ).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/projects$/);
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        savedPrompt,
      );
    }
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
