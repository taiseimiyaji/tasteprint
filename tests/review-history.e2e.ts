import { test, expect, type Page } from "@playwright/test";
import type { Review } from "../src/domain/review";
async function readyHistory(page: Page) {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Review history selection" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  const reviews: Review[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await page.request.post(`${base}/reviews`, {
      data: { baseRevision: 1 },
    });
    expect(response.ok()).toBe(true);
    reviews.push(await response.json());
  }
  const [older, origin] = reviews;
  const dismissed = await page.request.post(
    `${base}/reviews/${older.id}/dismiss`,
    {
      data: {
        baseRevision: 1,
        findingId: older.findings[0].id,
        reason: "HISTORY_B_MARKER",
      },
    },
  );
  expect(dismissed.ok()).toBe(true);
  await page.goto(`/projects/${project.id}/review`);
  await page.getByText("過去のレビュー", { exact: true }).click();
  const history = page.getByRole("button", {
    name: `revision ${older.baseRevision} · ${older.createdAt}`,
    exact: true,
  });
  const marker = page.getByText("見送り済み: HISTORY_B_MARKER", {
    exact: true,
  });
  await expect(history).toBeEnabled();
  await expect(marker).toHaveCount(0);
  return { base, older, origin, history, marker };
}
async function gateReply(page: Page, endpoint: string, fail = false) {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let posts = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = fail ? undefined : await route.fetch();
    entered();
    await gate;
    if (response) await route.fulfill({ response });
    else
      await route.fulfill({
        status: 503,
        json: { message: "候補作成の失敗を保持" },
      });
  });
  return { release: () => release(), started, count: () => posts };
}
for (const outcome of ["success", "failure"])
  test(`Review proposal ${outcome} keeps its history context until the action ends`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const f = await readyHistory(page);
    const gate = await gateReply(
      page,
      `**${f.base}/reviews/${f.origin.id}/proposals`,
      outcome === "failure",
    );
    await page
      .getByRole("button", { name: "修正案を作成", exact: true })
      .click();
    await gate.started;
    try {
      await expect(f.history).toBeDisabled();
      await expect(f.marker).toHaveCount(0);
      if (outcome === "success")
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1050 });
          await f.history.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `test-results/review-history-pending-${width}.png`,
          });
        }
    } finally {
      gate.release();
    }
    await expect(f.history).toBeEnabled();
    const candidates = page.getByRole("button", { name: /仮Preview:/ });
    if (outcome === "success") {
      await expect(candidates).toHaveCount(2);
      await candidates.first().click();
      await expect(
        page.getByRole("button", { name: "まとめて適用", exact: true }),
      ).toBeEnabled();
    } else {
      await expect(page.getByRole("alert")).toContainText(
        "候補作成の失敗を保持",
      );
      await expect(candidates).toHaveCount(0);
    }
    await f.history.click();
    await expect(f.marker).toBeVisible();
    await expect(candidates).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "まとめて適用", exact: true }),
    ).toHaveCount(0);
    expect(gate.count()).toBe(1);
  });
for (const action of ["create", "dismiss", "apply"])
  test(`Review ${action} also protects historical selection through the common action boundary`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const f = await readyHistory(page);
    if (action === "apply") {
      await page
        .getByRole("button", { name: "修正案を作成", exact: true })
        .click();
      const candidate = page
        .getByRole("button", { name: /仮Preview:/ })
        .first();
      await expect(candidate).toBeEnabled();
      await candidate.click();
    }
    const endpoint =
      action === "create"
        ? `**${f.base}/reviews`
        : action === "dismiss"
          ? `**${f.base}/reviews/${f.origin.id}/dismiss`
          : `**${f.base}/foundation/apply`;
    const gate = await gateReply(page, endpoint);
    if (action === "create")
      await page
        .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
        .click();
    else if (action === "apply")
      await page
        .getByRole("button", { name: "まとめて適用", exact: true })
        .click();
    else {
      const row = page.locator(".review-row").first();
      await row.getByRole("textbox").fill("CURRENT_A_DISMISS");
      await row.getByRole("button", { name: "見送る", exact: true }).click();
    }
    await gate.started;
    try {
      await expect(f.history).toBeDisabled();
      await expect(f.marker).toHaveCount(0);
    } finally {
      gate.release();
    }
    await expect(f.history).toBeEnabled();
    if (action === "apply")
      await expect(page.locator(".save-status")).toContainText("設計 r2");
    await f.history.click();
    await expect(f.marker).toBeVisible();
    expect(gate.count()).toBe(1);
  });
test("GET-only Review recovery permits historical browsing and preserves that selection without a mutation", async ({
  page,
}) => {
  test.setTimeout(90000);
  const f = await readyHistory(page);
  let fail = true,
    hold = false,
    release!: () => void,
    entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") posts++;
  });
  await page.route(`**${f.base}/reviews`, async (route) => {
    if (fail)
      return route.fulfill({
        status: 503,
        json: { message: "結果一覧の一時失敗" },
      });
    const response = await route.fetch();
    if (hold) {
      entered();
      await gate;
    }
    await route.fulfill({ response });
  });
  await expect(
    page.getByRole("button", { name: "結果を再取得", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  fail = false;
  hold = true;
  await page.getByRole("button", { name: "結果を再取得", exact: true }).click();
  await started;
  try {
    await expect(f.history).toBeEnabled();
    await f.history.click();
    await expect(f.marker).toBeVisible();
  } finally {
    hold = false;
    release();
  }
  await expect(
    page.getByRole("button", { name: "結果を再取得", exact: true }),
  ).toHaveCount(0);
  await expect(f.marker).toBeVisible();
  expect(posts).toBe(0);
});
test("existing API rejects findings from another Review and candidates from another Project or stale revision", async ({
  page,
}) => {
  test.setTimeout(90000);
  const f = await readyHistory(page);
  const finding = f.origin.findings.find((row) => row.source === "ai")!;
  expect(f.older.findings.some((row) => row.id === finding.id)).toBe(false);
  const wrongFinding = await page.request.post(
    `${f.base}/reviews/${f.older.id}/dismiss`,
    {
      data: { baseRevision: 1, findingId: finding.id, reason: "混入させない" },
    },
  );
  expect(wrongFinding.status()).toBe(404);
  const before = await (await page.request.get(`${f.base}/reviews`)).json();
  expect(
    before.find((r: Review) => r.id === f.older.id).findings[0].dismissal,
  ).toBe("HISTORY_B_MARKER");
  const proposed = await page.request.post(
    `${f.base}/reviews/${f.origin.id}/proposals`,
    { data: {} },
  );
  expect(proposed.ok()).toBe(true);
  const candidate = (await proposed.json()).candidates[0];
  const other = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Other candidate scope" }, useTaste: false },
    })
  ).json();
  const wrongProject = await page.request.post(
    `/api/projects/${other.id}/foundation/apply`,
    { data: { id: candidate.id } },
  );
  expect(wrongProject.status()).toBe(404);
  const current = (
    await (await page.request.get(`${f.base}/foundation`)).json()
  ).current;
  const advance = await page.request.post(`${f.base}/foundation/save`, {
    data: {
      baseRevision: 1,
      design: { ...current.design, accent: "#334455" },
      reason: "候補の基準版を進める",
      requestId: crypto.randomUUID(),
    },
  });
  expect(advance.ok()).toBe(true);
  const stale = await page.request.post(`${f.base}/foundation/apply`, {
    data: { id: candidate.id },
  });
  expect(stale.status()).toBe(409);
  const after = (await (await page.request.get(`${f.base}/foundation`)).json())
    .current;
  expect(after.revision).toBe(2);
  expect(after.design.accent).toBe("#334455");
});
