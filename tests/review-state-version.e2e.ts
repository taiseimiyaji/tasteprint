import { test, expect, type Page } from "@playwright/test";
import type { Review } from "../src/domain/review";

for (const replacement of ["更新した理由B", ""] as const) {
  test(`late confirmed reply preserves an observed same-finding ${replacement ? "new reason" : "empty reason"}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const created = await page.request.post("/api/projects", {
      data: {
        brief: { name: `Same finding ${replacement || "empty"}` },
        useTaste: false,
      },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const base = `/api/projects/${project.id}`;
    await page.goto(`/projects/${project.id}/review`);
    await page
      .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
      .click();
    await expect(
      page.getByText("要判断の指摘数:", { exact: false }),
    ).toBeVisible({ timeout: 90000 });
    const initial: Review = (
      await (await page.request.get(`${base}/reviews`)).json()
    )[0];
    const finding = initial.findings[0];
    expect(finding).toBeTruthy();
    expect(initial.stateVersion).toBe(0);
    const oldReason = "古い理由A";
    let release!: () => void;
    let committed!: () => void;
    let delivered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (committed = resolve));
    const finished = new Promise<void>((resolve) => (delivered = resolve));
    let oldReply!: Review;
    let failGets = false;
    await page.route(`**${base}/reviews`, async (route) => {
      if (failGets && route.request().method() === "GET")
        await route.fulfill({ status: 503, json: { message: "再読込失敗" } });
      else await route.continue();
    });
    await page.route(
      `**${base}/reviews/${initial.id}/dismiss`,
      async (route) => {
        const response = await route.fetch();
        oldReply = await response.json();
        committed();
        await gate;
        await route.fulfill({ response });
        delivered();
      },
    );
    try {
      await page.getByLabel(`見送り理由 ${finding.id}`).fill(oldReason);
      await page
        .locator(".review-row")
        .first()
        .getByRole("button", { name: "見送る" })
        .click();
      await started;
      expect(oldReply.findings[0].dismissal).toBe(oldReason);
      expect(oldReply.stateVersion).toBe(1);
      const changed = await page.request.post(
        `${base}/reviews/${initial.id}/dismiss`,
        {
          data: {
            baseRevision: initial.baseRevision,
            findingId: finding.id,
            reason: replacement,
          },
        },
      );
      expect(changed.ok()).toBe(true);
      const changedReview = (await changed.json()) as Review;
      expect(changedReview.findings[0].dismissal).toBe(replacement);
      expect(changedReview.stateVersion).toBe(2);
      await page
        .getByRole("navigation", { name: "プロジェクトの設計" })
        .getByRole("link", { name: "Export", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "プロジェクトの設計" })
        .getByRole("link", { name: "AI Review", exact: true })
        .click();
      const row = page.locator(".review-row").first();
      const shown = `見送り済み: ${replacement || "理由なし"}`;
      await expect(row.getByText(shown, { exact: true })).toBeVisible();
      failGets = true;
      release();
      await finished;
      await expect(page.getByRole("alert")).toContainText("再読込失敗");
      const persisted: Review = (
        await (await page.request.get(`${base}/reviews`)).json()
      )[0];
      expect(persisted.findings[0].dismissal).toBe(replacement);
      expect(persisted.stateVersion).toBe(2);
      await expect(row.getByText(shown, { exact: true })).toBeVisible();
    } finally {
      release();
    }
  });
}

async function ready(page: Page, name: string) {
  const created = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const base = `/api/projects/${project.id}`;
  const response = await page.request.post(`${base}/reviews`, {
    data: { baseRevision: 1 },
  });
  expect(response.ok()).toBe(true);
  const review = (await response.json()) as Review;
  await page.goto(`/projects/${project.id}/review`);
  await expect(page.locator(".review-row")).toHaveCount(review.findings.length);
  return { base, project, review };
}

test("a truly newer POST replaces an older observed GET snapshot", async ({
  page,
}) => {
  const { base, review } = await ready(page, "New POST after old GET");
  const finding = review.findings[0];
  let release!: () => void;
  let committed!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const started = new Promise<void>((r) => (committed = r));
  await page.route(`**${base}/reviews/${review.id}/dismiss`, async (route) => {
    const response = await route.fetch();
    expect((await response.json()).stateVersion).toBe(1);
    committed();
    await hold;
    await route.fulfill({ response });
  });
  await page.route(`**${base}/reviews`, async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({ json: [review] });
    else await route.continue();
  });
  try {
    await page.getByLabel(`見送り理由 ${finding.id}`).fill("新しいPOST理由");
    await page
      .locator(".review-row")
      .first()
      .getByRole("button", { name: "見送る" })
      .click();
    await started;
    await page
      .getByRole("navigation", { name: "プロジェクトの設計" })
      .getByRole("link", { name: "Export", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "プロジェクトの設計" })
      .getByRole("link", { name: "AI Review", exact: true })
      .click();
    await expect(
      page
        .locator(".review-row")
        .first()
        .getByRole("button", { name: "見送る" }),
    ).toBeVisible();
    release();
    await expect(
      page
        .locator(".review-row")
        .first()
        .getByText("見送り済み: 新しいPOST理由"),
    ).toBeVisible();
  } finally {
    release();
  }
});

test("invalid and contradictory GET versions keep draft, candidate and selection", async ({
  page,
}) => {
  const { base, review } = await ready(page, "Reject invalid Review versions");
  const finding = review.findings[0];
  const draft = page.getByLabel(`見送り理由 ${finding.id}`);
  await draft.fill("編集中の理由");
  await page.getByRole("button", { name: "修正案を作成", exact: true }).click();
  const candidate = page.getByRole("button", { name: /仮Preview:/ }).first();
  await expect(candidate).toBeVisible();
  await candidate.click();
  let payload: unknown = [{ ...review, stateVersion: "0" }];
  await page.route(`**${base}/reviews`, async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({ json: payload });
    else await route.continue();
  });
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "AI Review", exact: true })
    .click();
  for (const bad of ["0", 0.5, -1, undefined]) {
    payload = [{ ...review, stateVersion: bad }];
    await page.getByRole("button", { name: "結果を再取得" }).click();
    await expect(page.getByRole("alert")).toContainText("状態番号が不正");
    await expect(draft).toHaveValue("編集中の理由");
    await expect(candidate).toBeVisible();
    await expect(
      page.getByRole("button", { name: "まとめて適用" }),
    ).toBeEnabled();
  }
  payload = [
    {
      ...review,
      findings: review.findings.map((f, i) =>
        i === 0 ? { ...f, dismissal: "矛盾した同版理由" } : f,
      ),
    },
  ];
  await page.getByRole("button", { name: "結果を再取得" }).click();
  await expect(page.getByRole("alert")).toContainText("内容が一致しません");
  await expect(draft).toHaveValue("編集中の理由");
  await expect(candidate).toBeVisible();
});

test("same-version stale true never returns to false, including after a failed GET", async ({
  page,
}) => {
  const { base, review } = await ready(page, "Stale Review version");
  let payload: unknown = [{ ...review, stale: true }];
  await page.route(`**${base}/reviews`, async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill(
        payload === null
          ? { status: 503, json: { message: "再読込失敗" } }
          : { json: payload },
      );
    else await route.continue();
  });
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "AI Review", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: /古い結果/ })).toBeVisible();
  payload = [{ ...review, stale: false }];
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "AI Review", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: /古い結果/ })).toBeVisible();
  payload = null;
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "AI Review", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("再読込失敗");
  await expect(page.getByRole("heading", { name: /古い結果/ })).toBeVisible();
});

test("a rejected POST keeps historical selection, draft and candidate when the follow-up GET fails", async ({
  page,
}) => {
  const { base, review: older } = await ready(page, "Rejected historical POST");
  const newReview = await page.request.post(`${base}/reviews`, {
    data: { baseRevision: 1 },
  });
  expect(newReview.ok()).toBe(true);
  await page.reload();
  await page.getByText("過去のレビュー", { exact: true }).click();
  await page
    .getByRole("button", {
      name: `revision ${older.baseRevision} · ${older.createdAt}`,
      exact: true,
    })
    .click();
  const oldImage = page.locator(
    `a[href="${base}/reviews/images/${older.images[0]}"]`,
  );
  await expect(oldImage).toHaveCount(1);
  const draft = page.getByLabel(`見送り理由 ${older.findings[0].id}`);
  await draft.fill("まだ入力中");
  await page.getByRole("button", { name: "修正案を作成", exact: true }).click();
  const candidate = page.getByRole("button", { name: /仮Preview:/ }).first();
  await expect(candidate).toBeVisible();
  await candidate.click();
  await page.route(`**${base}/reviews`, async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({ status: 503, json: { message: "再読込失敗" } });
    else await route.continue();
  });
  await page.route(`**${base}/reviews/${older.id}/dismiss`, async (route) => {
    const response = await route.fetch();
    const invalid = await response.json();
    delete invalid.stateVersion;
    await route.fulfill({ json: invalid });
  });
  await page
    .locator(".review-row")
    .first()
    .getByRole("button", { name: "見送る" })
    .click();
  await expect(page.getByRole("alert")).toContainText("再読込失敗");
  await expect(oldImage).toHaveCount(1);
  await expect(draft).toHaveValue("まだ入力中");
  await expect(candidate).toBeVisible();
  await expect(
    page.getByRole("button", { name: "まとめて適用" }),
  ).toBeEnabled();
});

test("a pre-run delayed empty list cannot remove the new Review", async ({
  page,
}) => {
  const created = await page.request.post("/api/projects", {
    data: { brief: { name: "Delayed list before run" }, useTaste: false },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const base = `/api/projects/${project.id}`;
  let release!: () => void;
  let captured!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const started = new Promise<void>((r) => (captured = r));
  let first = true;
  await page.route(`**${base}/reviews`, async (route) => {
    if (!first || route.request().method() !== "GET") return route.continue();
    first = false;
    const response = await route.fetch();
    expect(await response.json()).toEqual([]);
    captured();
    await hold;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/projects/${project.id}/review`);
    await started;
    await page
      .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
      .click();
    await expect(
      page.getByText("要判断の指摘数:", { exact: false }),
    ).toBeVisible({ timeout: 90000 });
    release();
    await expect(page.locator(".review-row").first()).toBeVisible();
    const saved = (await (
      await page.request.get(`${base}/reviews`)
    ).json()) as Review[];
    expect(saved).toHaveLength(1);
    expect(saved[0].stateVersion).toBe(0);
  } finally {
    release();
  }
});
