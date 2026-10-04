import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

type Scope = { base: string; path: string; profile: boolean };
async function openScope(page: Page, profile: boolean): Promise<Scope> {
  let scope: Scope;
  if (profile)
    scope = { base: "/api/profile/references", path: "/profile", profile };
  else {
    const project = await (
      await page.request.post("/api/projects", {
        data: { brief: { name: "Reference response" }, useTaste: false },
      })
    ).json();
    scope = {
      base: `/api/projects/${project.id}/references`,
      path: `/projects/${project.id}/inspiration`,
      profile,
    };
  }
  return scope;
}
async function visit(page: Page, scope: Scope) {
  await page.goto(scope.path);
  if (scope.profile)
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
}
const input = (name: string) => ({
  name,
  url: "",
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
async function failReadsAfterMutation(page: Page, scope: Scope) {
  let failReads = false;
  let mutations = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith(scope.base) &&
      request.method() !== "GET"
    )
      mutations++;
  });
  await page.route(`**${scope.base}`, async (route) => {
    if (route.request().method() === "GET" && failReads)
      await route.fulfill({
        status: 503,
        json: { message: "参考一覧の再取得失敗" },
      });
    else await route.continue();
  });
  return {
    fail: () => (failReads = true),
    recover: () => (failReads = false),
    count: () => mutations,
    retry: async () => {
      const before = mutations;
      failReads = false;
      await page
        .getByRole("button", { name: "一覧を再取得", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "一覧を再取得", exact: true }),
      ).toHaveCount(0);
      expect(mutations).toBe(before);
    },
  };
}
async function image() {
  return {
    name: "response.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 1440, height: 1000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer(),
  };
}

for (const profile of [true, false]) {
  const label = profile ? "shared Profile" : "project";
  test(`${label} reference save keeps its successful version after GET failure`, async ({
    page,
  }) => {
    const scope = await openScope(page, profile);
    const reference = await (
      await page.request.post(scope.base, { data: input(`${label} saved`) })
    ).json();
    await visit(page, scope);
    const reads = await failReadsAfterMutation(page, scope);
    await page.route(`**${scope.base}/${reference.id}`, async (route) => {
      const response = await route.fetch();
      if (response.ok() && route.request().method() === "PATCH") reads.fail();
      await route.fulfill({ response });
    });
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: `${label} saved`, exact: true }),
    });
    const notes = card.getByRole("textbox", { name: "好きな点", exact: true });
    const save = card.getByRole("button", {
      name: "観点・メモを保存",
      exact: true,
    });
    await notes.fill("一度目のメモ");
    await save.click();
    await expect(page.getByRole("alert")).toContainText(
      "参考一覧の読み込みに失敗",
    );
    await expect(save).toBeDisabled();
    await expect(notes).toHaveValue("一度目のメモ");
    await notes.fill("二度目のメモ");
    const failedRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === scope.base &&
        response.status() === 503,
    );
    await save.click();
    await failedRead;
    await expect(save).toBeDisabled();
    await expect(notes).toBeEditable();
    const saved = (
      await (await page.request.get(scope.base)).json()
    ).references.find((r: { id: string }) => r.id === reference.id);
    expect(saved.version).toBe(reference.version + 2);
    expect(saved.likes).toBe("二度目のメモ");
    expect(reads.count()).toBe(2);
    await reads.retry();
    await page.reload();
    if (profile)
      await page
        .getByRole("button", { name: "参考を集める", exact: true })
        .click();
    await expect(notes).toHaveValue("二度目のメモ");
    await expect(save).toBeDisabled();
  });

  test(`${label} reference server failure keeps editable notes and retries once`, async ({
    page,
  }) => {
    const scope = await openScope(page, profile);
    const reference = await (
      await page.request.post(scope.base, { data: input(`${label} failed`) })
    ).json();
    await visit(page, scope);
    const endpoint = `**${scope.base}/${reference.id}`;
    await page.route(endpoint, (route) =>
      route.fulfill({ status: 500, json: { message: "参考保存失敗" } }),
    );
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: `${label} failed`, exact: true }),
    });
    const notes = card.getByRole("textbox", { name: "好きな点", exact: true });
    const save = card.getByRole("button", {
      name: "観点・メモを保存",
      exact: true,
    });
    await notes.fill("失敗しても残すメモ");
    await save.click();
    await expect(page.getByRole("alert")).toContainText("参考保存失敗");
    await expect(notes).toHaveValue("失敗しても残すメモ");
    await expect(save).toBeEnabled();
    await page.unroute(endpoint);
    await save.click();
    await expect(save).toBeDisabled();
    const saved = (
      await (await page.request.get(scope.base)).json()
    ).references.find((r: { id: string }) => r.id === reference.id);
    expect(saved.version).toBe(reference.version + 1);
    expect(saved.likes).toBe("失敗しても残すメモ");
  });

  test(`${label} reference create, image and delete remain committed after GET failure`, async ({
    page,
  }) => {
    const scope = await openScope(page, profile);
    await visit(page, scope);
    const reads = await failReadsAfterMutation(page, scope);
    await page.route(`**${scope.base}/*/image`, async (route) => {
      const response = await route.fetch();
      if (response.ok() && route.request().method() === "POST") reads.fail();
      await route.fulfill({ response });
    });
    await page
      .getByLabel("画像を追加", { exact: true })
      .setInputFiles(await image());
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "response.png", exact: true }),
    });
    await expect(card.getByAltText("response.pngの参考画像")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "参考一覧の読み込みに失敗",
    );
    await expect(
      card.getByRole("button", { name: "観点・メモを保存", exact: true }),
    ).toBeDisabled();
    expect(reads.count()).toBe(2);
    await reads.retry();
    reads.fail();
    await card.getByRole("button", { name: "削除", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText(
      "参考一覧の読み込みに失敗",
    );
    expect(reads.count()).toBe(3);
    await reads.retry();
    expect(
      (await (await page.request.get(scope.base)).json()).references.some(
        (r: { name: string }) => r.name === "response.png",
      ),
    ).toBe(false);
  });

  test(`${label} reference adoption stays committed and GET retry never adopts twice`, async ({
    page,
  }) => {
    const scope = await openScope(page, profile);
    await visit(page, scope);
    await page.getByLabel("画像を追加", { exact: true }).setInputFiles({
      ...(await image()),
      name: `${label}-adopt.png`,
    });
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: `${label}-adopt.png`,
        exact: true,
      }),
    });
    await expect(
      card.getByAltText(`${label}-adopt.pngの参考画像`),
    ).toBeVisible();
    await card.getByLabel("送信対象を確認しました").check();
    await card
      .getByRole("button", { name: "Codexで分析する", exact: true })
      .click();
    await expect(
      card.getByText("画像上部の見出し", { exact: true }),
    ).toBeVisible();
    const refs = (await (await page.request.get(scope.base)).json()).references;
    const before = refs.find(
      (r: { name: string }) => r.name === `${label}-adopt.png`,
    );
    const reads = await failReadsAfterMutation(page, scope);
    await page.route(`**${scope.base}/${before.id}/accept`, async (route) => {
      const response = await route.fetch();
      if (response.ok()) reads.fail();
      await route.fulfill({ response });
    });
    await card
      .getByRole("button", { name: "設計方針として採用", exact: true })
      .click();
    if (profile)
      await page
        .getByRole("button", { name: "参考を集める", exact: true })
        .click();
    await expect(
      card.getByRole("button", { name: "採用済み", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText(
      "参考一覧の読み込みに失敗",
    );
    if (profile) {
      await page
        .getByRole("button", { name: "DNA・原則", exact: true })
        .click();
      await expect(
        page
          .locator(".principle-fields")
          .getByLabel("原則", { exact: true })
          .last(),
      ).toHaveValue("見出しと本文の強弱を付ける");
      await page
        .getByRole("button", { name: "共通の好みを保存", exact: true })
        .click();
      await expect(page.getByText("共通の好みを保存しました")).toBeVisible();
      await page
        .getByRole("button", { name: "参考を集める", exact: true })
        .click();
    }
    await reads.retry();
    const after = (
      await (await page.request.get(scope.base)).json()
    ).references.find((r: { id: string }) => r.id === before.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.accepted).toEqual([0]);
    expect(reads.count()).toBe(1);
  });
}

for (const profile of [true, false]) {
  test(`${profile ? "shared Profile" : "project"} late GET cannot remove a committed URL while jobs POST waits`, async ({
    page,
  }) => {
    const scope = await openScope(page, profile);
    const loaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === scope.base &&
        response.request().method() === "GET",
    );
    await visit(page, scope);
    await loaded;
    let releaseOld!: () => void;
    let oldReady!: () => void;
    let oldDelivered!: () => void;
    const oldGate = new Promise<void>((resolve) => (releaseOld = resolve));
    const oldStarted = new Promise<void>((resolve) => (oldReady = resolve));
    const oldFinished = new Promise<void>(
      (resolve) => (oldDelivered = resolve),
    );
    let firstRead = true;
    await page.route(`**${scope.base}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (!firstRead)
        return route.fulfill({
          status: 503,
          json: { message: "参考一覧の再取得失敗" },
        });
      firstRead = false;
      const response = await route.fetch();
      oldReady();
      await oldGate;
      try {
        await route.fulfill({ response });
      } finally {
        oldDelivered();
      }
    });
    let releaseJob!: () => void;
    let jobReady!: () => void;
    const jobGate = new Promise<void>((resolve) => (releaseJob = resolve));
    const jobStarted = new Promise<void>((resolve) => (jobReady = resolve));
    await page.route(`**${scope.base}/*/jobs`, async (route) => {
      jobReady();
      await jobGate;
      await route.continue();
    });
    const name = `late-${profile ? "shared" : "project"}.example`;
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    try {
      await oldStarted;
      await page
        .getByRole("textbox", { name: "Reference URL" })
        .fill(`https://${name}`);
      await page
        .getByRole("button", { name: "参考を追加", exact: true })
        .click();
      await jobStarted;
      await expect(card).toBeVisible();
      releaseOld();
      await oldFinished;
      releaseJob();
      await expect(page.getByRole("alert")).toContainText(
        "参考一覧の読み込みに失敗",
      );
      await expect(card).toBeVisible();
      const server = (await (await page.request.get(scope.base)).json())
        .references;
      expect(server.some((r: { name: string }) => r.name === name)).toBe(true);
    } finally {
      releaseOld();
      releaseJob();
    }
  });
}
