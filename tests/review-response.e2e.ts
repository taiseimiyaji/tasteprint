import { test, expect, type Page } from "@playwright/test";
import type { Review } from "../src/domain/review";

async function readyReview(page: Page, name: string) {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  await page.goto(`/projects/${project.id}/review`);
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await expect(page.getByText("要判断の指摘数:", { exact: false })).toBeVisible(
    { timeout: 90000 },
  );
  return { id: project.id as string, base };
}
function countDismisses(page: Page) {
  let count = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.endsWith("/dismiss") &&
      request.method() === "POST"
    )
      count++;
  });
  return () => count;
}
const reason = "今回の設計では許容する";
function firstRow(page: Page) {
  return page.locator(".review-row").first();
}
async function dismiss(page: Page) {
  await firstRow(page).getByRole("textbox").fill(reason);
  await firstRow(page)
    .getByRole("button", { name: "見送る", exact: true })
    .click();
}
async function dismissed(page: Page) {
  await expect(
    firstRow(page).getByText(`見送り済み: ${reason}`, { exact: true }),
  ).toBeVisible();
  await expect(
    firstRow(page).getByRole("button", { name: "見送る", exact: true }),
  ).toHaveCount(0);
}

test("Review dismissal commits its reply before a failed GET and retries reads only", async ({
  page,
}) => {
  const { base } = await readyReview(page, "Dismiss GET failure");
  const updates = countDismisses(page);
  let fail = false;
  await page.route(`**${base}/reviews`, async (route) => {
    if (fail && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { message: "見送り後GET失敗" },
      });
    else await route.continue();
  });
  let reply!: Review;
  await page.route(`**${base}/reviews/*/dismiss`, async (route) => {
    const response = await route.fetch();
    reply = await response.json();
    fail = true;
    await route.fulfill({ response });
  });
  await dismiss(page);
  await expect(page.getByRole("alert")).toContainText("見送り後GET失敗");
  await dismissed(page);
  expect(updates()).toBe(1);
  expect(reply.findings[0].dismissal).toBe(reason);
  expect((await (await page.request.get(`${base}/reviews`)).json())[0]).toEqual(
    reply,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await firstRow(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/review-dismiss-${width}.png` });
  }
  fail = false;
  await page.getByRole("button", { name: "結果を再取得", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await dismissed(page);
  expect(updates()).toBe(1);
  await page.reload();
  await dismissed(page);
  await expect(page.locator(".save-status")).toContainText("設計 r1");
});

test("Review creation displays its successful result even if the following GET fails", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Review create response" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  let fail = false;
  let posts = 0;
  let reply!: Review;
  await page.route(`**${base}/reviews`, async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      const response = await route.fetch();
      reply = await response.json();
      fail = true;
      await route.fulfill({ response });
    } else if (fail)
      await route.fulfill({
        status: 503,
        json: { message: "新規結果GET失敗" },
      });
    else await route.continue();
  });
  await page.goto(`/projects/${project.id}/review`);
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("新規結果GET失敗", {
    timeout: 90000,
  });
  await expect(
    page.getByText("要判断の指摘数:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href="${base}/reviews/images/${reply.images[0]}"]`),
  ).toHaveCount(1);
  expect(posts).toBe(1);
  fail = false;
  await page.getByRole("button", { name: "結果を再取得", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(posts).toBe(1);
});

for (const failure of [false, true]) {
  test(`Review dismiss reply survives an older poll that ${failure ? "fails" : "succeeds"} late`, async ({
    page,
  }) => {
    const { base } = await readyReview(page, `Review old read ${failure}`);
    const updates = countDismisses(page);
    let release!: () => void;
    let ready!: () => void;
    let finished!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (ready = resolve));
    const delivered = new Promise<void>((resolve) => (finished = resolve));
    let first = true;
    await page.route(`**${base}/reviews`, async (route) => {
      if (!first || route.request().method() !== "GET") return route.continue();
      first = false;
      const response = await route.fetch();
      ready();
      await gate;
      try {
        if (failure)
          await route.fulfill({
            status: 503,
            json: { message: "古いReview GET失敗" },
          });
        else await route.fulfill({ response });
      } finally {
        finished();
      }
    });
    try {
      await started;
      await dismiss(page);
      await dismissed(page);
      release();
      await delivered;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await dismissed(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(updates()).toBe(1);
      await page.reload();
      await dismissed(page);
    } finally {
      release();
    }
  });
}

test("Review failed dismissal retains reason and unresolved finding until explicit retry", async ({
  page,
}) => {
  const { base } = await readyReview(page, "Dismiss POST failure");
  const updates = countDismisses(page);
  const endpoint = `**${base}/reviews/*/dismiss`;
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 500, json: { message: "見送り保存失敗" } }),
  );
  await dismiss(page);
  await expect(page.getByRole("alert")).toContainText("見送り保存失敗");
  await expect(firstRow(page).getByRole("textbox")).toHaveValue(reason);
  await expect(
    firstRow(page).getByRole("button", { name: "見送る", exact: true }),
  ).toBeEnabled();
  expect(
    (await (await page.request.get(`${base}/reviews`)).json())[0].findings[0]
      .dismissal,
  ).toBeUndefined();
  await page.unroute(endpoint);
  await firstRow(page)
    .getByRole("button", { name: "見送る", exact: true })
    .click();
  await dismissed(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(updates()).toBe(2);
});

test("Review dismissal keeps the selected historical review", async ({
  page,
}) => {
  const { base } = await readyReview(page, "Historical dismissal");
  const old = (await (await page.request.get(`${base}/reviews`)).json())[0];
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await expect(
    page.locator(`a[href="${base}/reviews/images/${old.images[0]}"]`),
  ).toHaveCount(0, { timeout: 90000 });
  const history = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "過去のレビュー" }) });
  await history.locator("summary").click();
  await history.getByRole("button").first().click();
  await expect(
    page.locator(`a[href="${base}/reviews/images/${old.images[0]}"]`),
  ).toHaveCount(1);
  await dismiss(page);
  await dismissed(page);
  await expect(
    page.locator(`a[href="${base}/reviews/images/${old.images[0]}"]`),
  ).toHaveCount(1);
  const reviews: Review[] = await (
    await page.request.get(`${base}/reviews`)
  ).json();
  expect(reviews.find((r) => r.id === old.id)!.findings[0].dismissal).toBe(
    reason,
  );
  expect(reviews[0].findings[0].dismissal).toBeUndefined();
});
