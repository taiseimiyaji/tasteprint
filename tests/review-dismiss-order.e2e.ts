import { test, expect } from "@playwright/test";
import type { Review } from "../src/domain/review";

test("a delayed dismissal reply preserves a newer observed dismissal after GET fails", async ({
  page,
}) => {
  test.setTimeout(120000);
  const projectResponse = await page.request.post("/api/projects", {
    data: { brief: { name: "Delayed Review dismissal" }, useTaste: false },
  });
  expect(projectResponse.ok()).toBe(true);
  const project = await projectResponse.json();
  const base = `/api/projects/${project.id}`;
  await page.goto(`/projects/${project.id}/review`);
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await expect(page.getByText("要判断の指摘数:", { exact: false })).toBeVisible(
    {
      timeout: 90000,
    },
  );
  const initial: Review = (
    await (await page.request.get(`${base}/reviews`)).json()
  )[0];
  expect(initial.findings.length).toBeGreaterThanOrEqual(2);
  const [a, b] = initial.findings;
  const bRow = page.locator(".review-row").nth(1);
  const reasonA = "先に見送った理由 A";
  const reasonB = "後から見送った理由 B";
  let releaseA!: () => void;
  let aCommitted!: () => void;
  let aDelivered!: () => void;
  const holdA = new Promise<void>((resolve) => (releaseA = resolve));
  const committedA = new Promise<void>((resolve) => (aCommitted = resolve));
  const deliveredA = new Promise<void>((resolve) => (aDelivered = resolve));
  let replyA!: Review;
  let failGets = false;
  await page.route(`**${base}/reviews`, async (route) => {
    if (failGets && route.request().method() === "GET")
      await route.fulfill({ status: 503, json: { message: "再読込失敗" } });
    else await route.continue();
  });
  await page.route(`**${base}/reviews/${initial.id}/dismiss`, async (route) => {
    const body = route.request().postDataJSON();
    if (body.findingId !== a.id) return route.continue();
    const response = await route.fetch();
    replyA = await response.json();
    aCommitted();
    await holdA;
    await route.fulfill({ response });
    aDelivered();
  });
  try {
    await page.getByLabel(`見送り理由 ${a.id}`).fill(reasonA);
    await page
      .locator(".review-row")
      .first()
      .getByRole("button", { name: "見送る" })
      .click();
    await committedA;
    expect(replyA.findings[0].dismissal).toBe(reasonA);
    expect(replyA.findings[1].dismissal).toBeUndefined();

    const bReply = await page.request.post(
      `${base}/reviews/${initial.id}/dismiss`,
      {
        data: {
          baseRevision: initial.baseRevision,
          findingId: b.id,
          reason: reasonB,
        },
      },
    );
    expect(bReply.ok()).toBe(true);
    expect(((await bReply.json()) as Review).findings[1].dismissal).toBe(
      reasonB,
    );
    await page
      .getByRole("navigation", { name: "プロジェクトの設計" })
      .getByRole("link", { name: "Export", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "プロジェクトの設計" })
      .getByRole("link", { name: "AI Review", exact: true })
      .click();
    await expect(
      bRow.getByText(`見送り済み: ${reasonB}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".review-row")
        .first()
        .getByText(`見送り済み: ${reasonA}`, { exact: true }),
    ).toBeVisible();

    failGets = true;
    releaseA();
    await deliveredA;
    await expect(page.getByRole("alert")).toContainText("再読込失敗");
    const persisted: Review = (
      await (await page.request.get(`${base}/reviews`)).json()
    )[0];
    expect(persisted.findings[0].dismissal).toBe(reasonA);
    expect(persisted.findings[1].dismissal).toBe(reasonB);
    await expect(
      bRow.getByText(`見送り済み: ${reasonB}`, { exact: true }),
    ).toBeVisible();
    await expect(bRow.getByRole("button", { name: "見送る" })).toHaveCount(0);
    await expect(
      page
        .locator(".review-row")
        .first()
        .getByText(`見送り済み: ${reasonA}`, { exact: true }),
    ).toBeVisible();
  } finally {
    releaseA();
  }
});
