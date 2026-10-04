import { test, expect, type Page } from "@playwright/test";
import type { Review } from "../src/domain/review";
async function ready(page: Page) {
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Stable review reasons" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const response = await page.request.post(`${base}/reviews`, {
    data: { baseRevision: 1 },
  });
  expect(response.ok()).toBe(true);
  const review: Review = await response.json();
  expect(review.findings.length).toBeGreaterThan(1);
  await page.goto(`/projects/${p.id}/review`);
  const reason = page.getByRole("textbox", {
    name: `見送り理由 ${review.findings[0].id}`,
    exact: true,
  });
  const other = page.getByRole("textbox", {
    name: `見送り理由 ${review.findings[1].id}`,
    exact: true,
  });
  await reason.fill("Submitted reason");
  await other.fill("Other finding draft");
  return {
    base,
    review,
    reason,
    other,
    dismiss: page
      .locator(".review-row")
      .filter({ has: reason })
      .getByRole("button", { name: "見送る", exact: true }),
  };
}
function gate() {
  let release!: () => void, enter!: () => void;
  return {
    wait: new Promise<void>((resolve) => (release = resolve)),
    started: new Promise<void>((resolve) => (enter = resolve)),
    release: () => release(),
    enter: () => enter(),
  };
}
async function blockPost(page: Page, endpoint: string) {
  const wait = gate();
  let fail = false,
    calls = 0;
  let body: unknown;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    body = route.request().postDataJSON();
    wait.enter();
    await wait.wait;
    if (fail)
      await route.fulfill({
        status: 503,
        json: { message: "Mock review update failure" },
      });
    else await route.continue();
  });
  return {
    ...wait,
    fail: (value: boolean) => (fail = value),
    count: () => calls,
    body: () => body,
  };
}
async function noPendingEdits(
  page: Page,
  f: Awaited<ReturnType<typeof ready>>,
) {
  await expect(f.reason).toBeDisabled();
  await expect(f.other).toBeDisabled();
  await expect(f.reason).toHaveValue("Submitted reason");
  await expect(f.other).toHaveValue("Other finding draft");
  await expect(page.locator(".review-row input:enabled")).toHaveCount(0);
}
for (const width of [1440, 390]) {
  test(`Dismissal locks reasons until success and preserves other drafts at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const f = await ready(page);
    const pending = await blockPost(
      page,
      `**${f.base}/reviews/${f.review.id}/dismiss`,
    );
    let failRead = width === 390;
    const read = gate();
    let holdRead = false;
    await page.route(`**${f.base}/reviews`, async (route) => {
      if (failRead)
        return route.fulfill({
          status: 503,
          json: { message: "Mock reason history failure" },
        });
      if (holdRead) {
        read.enter();
        await read.wait;
      }
      await route.continue();
    });
    await f.dismiss.click();
    await pending.started;
    try {
      await noPendingEdits(page, f);
      expect(pending.body()).toMatchObject({
        reason: "Submitted reason",
        findingId: f.review.findings[0].id,
      });
      await f.reason.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/review-reason-pending-${width}.png`,
      });
    } finally {
      pending.release();
    }
    await expect(
      page.getByText("見送り済み: Submitted reason", { exact: true }),
    ).toBeVisible();
    await expect(f.reason).toHaveCount(0);
    await expect(f.other).toBeEnabled();
    await expect(f.other).toHaveValue("Other finding draft");
    expect(pending.count()).toBe(1);
    if (width === 390) {
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Mock reason history failure" }),
      ).toBeVisible();
      failRead = false;
      holdRead = true;
      await page
        .getByRole("button", { name: "結果を再取得", exact: true })
        .click();
      await read.started;
      try {
        await expect(f.other).toBeEnabled();
        await f.other.fill("Edit during GET only");
      } finally {
        read.release();
      }
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Mock reason history failure" }),
      ).toHaveCount(0);
      await expect(f.other).toHaveValue("Edit during GET only");
      expect(pending.count()).toBe(1);
    }
    const saved: Review[] = await (
      await page.request.get(`${f.base}/reviews`)
    ).json();
    const current = saved.find((r) => r.id === f.review.id)!;
    expect(current.findings[0].dismissal).toBe("Submitted reason");
    expect(current.findings[1].dismissal).toBeUndefined();
  });
}
test("Failed dismissal restores editable original reasons and permits an explicit retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1050 });
  const f = await ready(page);
  const pending = await blockPost(
    page,
    `**${f.base}/reviews/${f.review.id}/dismiss`,
  );
  pending.fail(true);
  await f.dismiss.click();
  await pending.started;
  try {
    await noPendingEdits(page, f);
  } finally {
    pending.release();
  }
  await expect(
    page.getByRole("alert").filter({ hasText: "Mock review update failure" }),
  ).toBeVisible();
  await expect(f.reason).toBeEnabled();
  await expect(f.reason).toHaveValue("Submitted reason");
  await expect(f.other).toBeEnabled();
  await expect(f.other).toHaveValue("Other finding draft");
  const unchanged: Review[] = await (
    await page.request.get(`${f.base}/reviews`)
  ).json();
  expect(
    unchanged.find((r) => r.id === f.review.id)!.findings[0].dismissal,
  ).toBeUndefined();
  pending.fail(false);
  await f.dismiss.click();
  await expect(
    page.getByText("見送り済み: Submitted reason", { exact: true }),
  ).toBeVisible();
  await expect(f.other).toBeEnabled();
  await expect(f.other).toHaveValue("Other finding draft");
  expect(pending.count()).toBe(2);
});
test("Review proposal creation prevents reason edits until its result arrives", async ({
  page,
}) => {
  const f = await ready(page);
  const pending = await blockPost(
    page,
    `**${f.base}/reviews/${f.review.id}/proposals`,
  );
  await page.getByRole("button", { name: "修正案を作成", exact: true }).click();
  await pending.started;
  try {
    await noPendingEdits(page, f);
  } finally {
    pending.release();
  }
  await expect(page.getByRole("button", { name: /仮Preview:/ })).toHaveCount(2);
  await expect(f.reason).toBeEnabled();
  await expect(f.reason).toHaveValue("Submitted reason");
  await expect(f.other).toHaveValue("Other finding draft");
});
test("Starting a new Review protects and retains the old Review reason drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1050 });
  const f = await ready(page);
  const pending = await blockPost(page, `**${f.base}/reviews`);
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await pending.started;
  try {
    await noPendingEdits(page, f);
  } finally {
    pending.release();
  }
  await expect(
    page.getByRole("button", { name: "3画面を撮影してレビュー", exact: true }),
  ).toBeEnabled();
  await page.getByText("過去のレビュー", { exact: true }).click();
  await page
    .getByRole("button", {
      name: `revision 1 · ${f.review.createdAt}`,
      exact: true,
    })
    .click();
  await expect(f.reason).toBeEnabled();
  await expect(f.reason).toHaveValue("Submitted reason");
  await expect(f.other).toHaveValue("Other finding draft");
});
test("Applying a Review candidate protects reasons and retains them after revision advances", async ({
  page,
}) => {
  const f = await ready(page);
  await page.getByRole("button", { name: "修正案を作成", exact: true }).click();
  await page
    .getByRole("button", { name: /仮Preview:/ })
    .first()
    .click();
  const pending = await blockPost(page, `**${f.base}/foundation/apply`);
  await page.getByRole("button", { name: "まとめて適用", exact: true }).click();
  await pending.started;
  try {
    await noPendingEdits(page, f);
  } finally {
    pending.release();
  }
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await expect(f.reason).toBeEnabled();
  await expect(f.reason).toHaveValue("Submitted reason");
  await expect(f.other).toHaveValue("Other finding draft");
});
