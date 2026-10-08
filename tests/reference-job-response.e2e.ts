import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

type Scope = { base: string; path: string; profile: boolean };
async function scopeFor(page: Page, profile: boolean): Promise<Scope> {
  if (profile)
    return { base: "/api/profile/references", path: "/profile", profile };
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Job response" }, useTaste: false },
    })
  ).json();
  return {
    base: `/api/projects/${project.id}/references`,
    path: `/projects/${project.id}/inspiration`,
    profile,
  };
}
async function visit(page: Page, scope: Scope) {
  await page.goto(scope.path);
  if (scope.profile)
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
}
const input = (name: string, url = "") => ({
  name,
  url,
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
async function readsFor(page: Page, scope: Scope) {
  let fail = false;
  let mutations = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith(scope.base) &&
      request.method() !== "GET"
    )
      mutations++;
  });
  await page.route(`**${scope.base}`, async (route) => {
    if (route.request().method() === "GET" && fail)
      await route.fulfill({
        status: 503,
        json: { message: "Job list read failed" },
      });
    else await route.continue();
  });
  return {
    fail: () => {
      fail = true;
    },
    count: () => mutations,
    recover: async () => {
      const before = mutations;
      fail = false;
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
const cardFor = (page: Page, name: string) =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

for (const profile of [true, false]) {
  const label = profile ? "Profile" : "project";
  test(`${label} URL addition retains its accepted job and canceled reply across GET failures`, async ({
    page,
  }) => {
    const scope = await scopeFor(page, profile);
    await visit(page, scope);
    const reads = await readsFor(page, scope);
    let job: any;
    await page.route(`**${scope.base}/*/jobs`, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      job = await response.json();
      expect(["queued", "running"]).toContain(job.state);
      reads.fail();
      await route.fulfill({ response });
    });
    const name = `pending-${label.toLowerCase()}.example`;
    const card = cardFor(page, name);
    try {
      await page
        .getByRole("textbox", { name: "Reference URL" })
        .fill(`https://${name}/e2e-pending`);
      await page
        .getByRole("button", { name: "参考を追加", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "参考一覧の読み込みに失敗",
      );
      await expect(card.getByRole("status")).toContainText(
        /URL取得: (処理中|待機中)/,
      );
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toBeDisabled();
      if (profile) {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1050 });
          await card
            .getByRole("status")
            .evaluate((element) => element.scrollIntoView({ block: "center" }));
          await page.screenshot({
            path: `test-results/reference-job-${width}.png`,
          });
        }
        await page.setViewportSize({ width: 1440, height: 1050 });
      }
      await card.getByRole("button", { name: "中断する", exact: true }).click();
      await expect(card.getByRole("status")).toContainText("URL取得: 中断済み");
      await expect(
        card.getByRole("button", { name: "中断する", exact: true }),
      ).toHaveCount(0);
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toBeEditable();
      const stored = await (
        await page.request.get(`${scope.base}/jobs/${job.id}`)
      ).json();
      expect(stored.job.state).toBe("canceled");
      expect(reads.count()).toBe(3); // Reference create, job enqueue, cancel.
      await expect(page.getByRole("alert")).toContainText(
        "参考一覧の読み込みに失敗",
      );
      await reads.recover();
      await page.reload();
      if (scope.profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      await expect(card.getByRole("status")).toContainText("URL取得: 中断済み");
    } finally {
      if (job) await page.request.post(`${scope.base}/jobs/${job.id}/cancel`);
    }
  });

  test(`${label} analysis retains its accepted job while completed results require only a GET recovery`, async ({
    page,
  }) => {
    const scope = await scopeFor(page, profile);
    const name = `analyze-${label}`;
    const ref = await (
      await page.request.post(scope.base, { data: input(name) })
    ).json();
    const image = await sharp({
      create: { width: 1440, height: 1000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const upload = await page.request.post(`${scope.base}/${ref.id}/image`, {
      multipart: {
        version: String(ref.version),
        image: { name: "job.png", mimeType: "image/png", buffer: image },
      },
    });
    expect(upload.ok()).toBe(true);
    await visit(page, scope);
    const reads = await readsFor(page, scope);
    await page.route(`**${scope.base}/${ref.id}/jobs`, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      expect((await response.json()).type).toBe("analyze");
      reads.fail();
      await route.fulfill({ response });
    });
    const card = cardFor(page, name);
    await card
      .getByRole("checkbox", { name: "送信対象を確認しました", exact: true })
      .check();
    await card
      .getByRole("button", { name: "Codexで分析する", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "参考一覧の読み込みに失敗",
    );
    await expect(card.getByRole("status")).toContainText("Codex分析");
    await expect(
      card.getByRole("button", { name: "Codexで分析する", exact: true }),
    ).toBeDisabled();
    await expect(
      card.getByRole("button", {
        name: /^(設計方針として採用|プロジェクト方針として保存)$/,
        exact: true,
      }),
    ).toHaveCount(0);
    expect(reads.count()).toBe(1);
    await reads.recover();
    await expect(card.getByRole("status")).toContainText("Codex分析: 完了");
    await expect(
      card.getByRole("button", {
        name: /^(設計方針として採用|プロジェクト方針として保存)$/,
        exact: true,
      }),
    ).toBeVisible();
    expect(reads.count()).toBe(1);
    const stored = (
      await (await page.request.get(scope.base)).json()
    ).references.find((r: any) => r.id === ref.id);
    expect(stored.version).toBe(ref.version + 2);
    expect(stored.accepted).toEqual([]);
  });

  test(`${label} failed start and cancel keep input and active state until explicit retry succeeds`, async ({
    page,
  }) => {
    const scope = await scopeFor(page, profile);
    const name = `retry-${label}`;
    const ref = await (
      await page.request.post(scope.base, {
        data: input(name, "https://retry.example/e2e-pending"),
      })
    ).json();
    await visit(page, scope);
    const reads = await readsFor(page, scope);
    let failStart = true;
    let failCancel = true;
    let job: any;
    await page.route(`**${scope.base}/${ref.id}/jobs`, async (route) => {
      if (failStart)
        return route.fulfill({
          status: 500,
          json: { message: "start failed" },
        });
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      job = await response.json();
      reads.fail();
      await route.fulfill({ response });
    });
    await page.route(`**${scope.base}/jobs/*/cancel`, async (route) => {
      if (failCancel)
        return route.fulfill({
          status: 500,
          json: { message: "cancel failed" },
        });
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      expect((await response.json()).state).toBe("canceled");
      await route.fulfill({ response });
    });
    const card = cardFor(page, name);
    try {
      await card
        .getByRole("button", { name: "URLを取得", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("start failed");
      await expect(card.getByRole("status")).toHaveCount(0);
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toBeEditable();
      failStart = false;
      await card
        .getByRole("button", { name: "URLを取得", exact: true })
        .click();
      await expect(
        card.getByRole("button", { name: "中断する", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toContainText(
        "参考一覧の読み込みに失敗",
      );
      await card.getByRole("button", { name: "中断する", exact: true }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "cancel failed" }),
      ).toBeVisible();
      await expect(
        card.getByRole("button", { name: "中断する", exact: true }),
      ).toBeEnabled();
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toBeDisabled();
      failCancel = false;
      await card.getByRole("button", { name: "中断する", exact: true }).click();
      await expect(card.getByRole("status")).toContainText("中断済み");
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toBeEditable();
      await card
        .getByRole("textbox", { name: "好きな点", exact: true })
        .fill("中断後の下書き");
      await expect(page.getByRole("alert")).toContainText(
        "参考一覧の読み込みに失敗",
      );
      await reads.recover();
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toHaveValue("中断後の下書き");
      expect(reads.count()).toBe(4);
    } finally {
      if (job) await page.request.post(`${scope.base}/jobs/${job.id}/cancel`);
    }
  });
}
