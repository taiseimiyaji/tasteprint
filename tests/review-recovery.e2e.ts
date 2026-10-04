import { test, expect, type Page } from "@playwright/test";

async function createProject(page: Page, name: string) {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name }, useTaste: false },
    })
  ).json();
  return { id: project.id as string, base: `/api/projects/${project.id}` };
}
async function preparedReview(page: Page, name: string) {
  const project = await createProject(page, name);
  await page.goto(`/projects/${project.id}/review`);
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await expect(page.getByText("要判断の指摘数:", { exact: false })).toBeVisible(
    { timeout: 90000 },
  );
  await page.getByRole("button", { name: "修正案を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "仮Preview:", exact: false })
    .first()
    .click();
  return project;
}
function countUpdates(page: Page, base: string) {
  let count = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith(base) &&
      request.method() !== "GET"
    )
      count++;
  });
  return () => count;
}
async function failedReadAfterApply(page: Page, base: string) {
  let fail = false;
  await page.route(`**${base}/reviews`, async (route) => {
    if (fail && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { message: "レビュー結果の再取得失敗" },
      });
    else await route.continue();
  });
  await page.route(`**${base}/foundation/apply`, async (route) => {
    const response = await route.fetch();
    if (response.ok()) fail = true;
    await route.fulfill({ response });
  });
  return () => (fail = false);
}

test("Review initial read failure recovers with GET only", async ({ page }) => {
  const { id, base } = await createProject(page, "Review initial GET");
  const updates = countUpdates(page, base);
  let fail = true;
  await page.route(`**${base}/reviews`, async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        json: { message: "レビュー初期読取失敗" },
      });
    else await route.continue();
  });
  await page.goto(`/projects/${id}/review`);
  await expect(page.getByRole("alert")).toContainText("レビュー初期読取失敗");
  await expect(
    page.getByRole("button", { name: "結果を再取得", exact: true }),
  ).toBeEnabled();
  fail = false;
  await page.getByRole("button", { name: "結果を再取得", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".save-status")).toContainText("設計 r1");
  expect(updates()).toBe(0);
});

test("Review apply stays committed while GET-only recovery keeps revision and avoids repeat updates", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { id, base } = await preparedReview(page, "Review retry GET");
  const updates = countUpdates(page, base);
  const recover = await failedReadAfterApply(page, base);
  const reply = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${base}/foundation/apply` &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "まとめて適用", exact: true }).click();
  const applied = await (await reply).json();
  await expect(page.getByRole("alert")).toContainText(
    "確定した設計と表示中の結果は保持",
  );
  await expect(
    page.getByRole("button", { name: "結果を再取得", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  expect(updates()).toBe(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page
      .getByRole("button", { name: "結果を再取得", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/review-read-recovery-${width}.png`,
    });
  }
  recover();
  await page.getByRole("button", { name: "結果を再取得", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(updates()).toBe(1);
  await page.reload();
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const current = (await (await page.request.get(`${base}/foundation`)).json())
    .current;
  expect(current.revision).toBe(2);
  const stored = await page.evaluate(
    (id) =>
      JSON.parse(
        localStorage.getItem(`tasteprint.scope.${id}.draft.v1`) || "null",
      ),
    id,
  );
  expect(current.design).toEqual(applied.design);
  expect(stored.design).toEqual(applied.design);
  expect(stored.baseRevision).toBe(applied.revision);
});

test("Review automatic successful GET clears only its transient read warning", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { base } = await preparedReview(page, "Review automatic GET");
  const updates = countUpdates(page, base);
  const recover = await failedReadAfterApply(page, base);
  await page.getByRole("button", { name: "まとめて適用", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "レビュー結果の再取得失敗",
  );
  await expect(
    page.getByRole("button", { name: "結果を再取得", exact: true }),
  ).toBeEnabled();
  recover();
  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  expect(updates()).toBe(1);
});

test("Review successful GET keeps a failed apply error and its candidate until explicit retry", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { base } = await preparedReview(page, "Review failed POST");
  const updates = countUpdates(page, base);
  const endpoint = `**${base}/foundation/apply`;
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 500, json: { message: "直近のReview適用失敗" } }),
  );
  const apply = page.getByRole("button", { name: "まとめて適用", exact: true });
  await apply.click();
  await expect(page.getByRole("alert")).toContainText("直近のReview適用失敗");
  await expect(apply).toBeEnabled();
  const read = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${base}/reviews` &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await read;
  await expect(page.getByRole("alert")).toContainText("直近のReview適用失敗");
  await expect(
    page.getByRole("heading", { name: "仮Preview · 未適用", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("設計 r1");
  expect(updates()).toBe(1);
  await page.unroute(endpoint);
  await apply.click();
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(updates()).toBe(2);
  expect(
    (await (await page.request.get(`${base}/foundation`)).json()).current
      .revision,
  ).toBe(2);
});
