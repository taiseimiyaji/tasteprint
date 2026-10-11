import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Review } from "../src/domain/review";
import type { Candidate, Revision } from "../src/client/foundation-api";

async function nav(page: Page, name: string) {
  if (page.viewportSize()!.width === 390)
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.locator("nav").getByRole("link", { name, exact: true }).click();
}
const choices = (page: Page) =>
  page.getByRole("button", { name: /仮Preview:/ });
const apply = (page: Page) =>
  page.getByRole("button", { name: "まとめて適用", exact: true });
const generate = (page: Page) =>
  page.getByRole("button", { name: "修正案を作成", exact: true });
const reason = (page: Page, review: Review, index = 0) =>
  page.getByRole("textbox", {
    name: `見送り理由 ${review.findings[index].id}`,
    exact: true,
  });
async function createReview(page: Page, base: string): Promise<Review> {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `${base}/reviews` &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  const r = await response;
  expect(r.ok()).toBe(true);
  const review: Review = await r.json();
  await expect(page.locator(".review-row")).toHaveCount(review.findings.length);
  await expect(generate(page)).toBeEnabled();
  return review;
}
async function stage(
  page: Page,
  base: string,
  review: Review,
  index = 1,
): Promise<Candidate> {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `${base}/reviews/${review.id}/proposals` &&
      r.request().method() === "POST",
  );
  await generate(page).click();
  const r = await response;
  expect(r.ok()).toBe(true);
  const candidates: Candidate[] = (await r.json()).candidates;
  await expect(choices(page)).toHaveCount(candidates.length);
  await expect(generate(page)).toBeEnabled();
  await choices(page).nth(index).click();
  await expect(choices(page).nth(index)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  return candidates[index];
}
async function selectReview(page: Page, review: Review) {
  const history = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "過去のレビュー" }) });
  if ((await history.getAttribute("open")) === null)
    await history.locator("summary").click();
  await history
    .getByRole("button", {
      name: `revision ${review.baseRevision} · ${review.createdAt}`,
      exact: true,
    })
    .click();
}
async function prepared(
  page: Page,
  name: string,
  existing?: { id: string; brief: { name: string } },
) {
  const project =
    existing ??
    (await (
      await page.request.post("/api/projects", {
        data: { brief: { name }, useTaste: false },
      })
    ).json());
  const base = `/api/projects/${project.id}`;
  const posts: { path: string; body: any }[] = [];
  const errors: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith(base) && r.method() === "POST")
      posts.push({ path, body: r.postDataJSON() });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  if (existing) await nav(page, "AI Review");
  else await page.goto(`/projects/${project.id}/review`);
  const review = await createReview(page, base);
  await reason(page, review).fill("未送信の理由 A");
  await reason(page, review, 1).fill("未送信の理由 B");
  const candidate = await stage(page, base, review);
  const read = async (): Promise<Revision> =>
    (await (await page.request.get(`${base}/foundation`)).json()).current;
  const count = (suffix: string) =>
    posts.filter((p) => p.path.endsWith(suffix)).length;
  const check = async () => {
    expect(errors).toEqual([]);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  };
  return { project, base, review, candidate, posts, read, count, check };
}
async function jsonDownload(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

for (const width of [1440, 390])
  test(`Review consideration survives every Workspace step without regeneration at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const f = await prepared(page, `Review Workspace steps ${width}`);
    const saved = await f.read();
    for (const step of [
      "Inspiration",
      "Foundation",
      "Components",
      "Patterns",
      "Preview",
      "Export",
    ]) {
      await nav(page, step);
      await expect(page.locator(".review-results")).toHaveCount(0);
      if (step === "Foundation")
        await expect(page.locator("iframe")).toHaveCount(1);
      if (step === "Export") {
        const exported = await jsonDownload(page);
        expect(exported.revision).toBe(1);
        expect(exported.design).toEqual(saved.design);
      }
      await nav(page, "AI Review");
      await expect(reason(page, f.review)).toHaveValue("未送信の理由 A");
      await expect(reason(page, f.review, 1)).toHaveValue("未送信の理由 B");
      await expect(choices(page).nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(apply(page)).toBeEnabled();
      expect(f.count("/proposals")).toBe(1);
    }
    await apply(page).click();
    await expect(page.locator(".save-status")).toContainText("設計 r2");
    await expect(choices(page)).toHaveCount(0);
    expect(f.posts.find((p) => p.path.endsWith("/apply"))!.body.id).toBe(
      f.candidate.id,
    );
    await expect(reason(page, f.review, 1)).toHaveValue("未送信の理由 B");
    await nav(page, "Export");
    const exported = await jsonDownload(page);
    expect(exported.revision).toBe(2);
    expect(exported.design).toEqual(f.candidate.design);
    await nav(page, "AI Review");
    await expect(choices(page)).toHaveCount(0);
    expect(f.count("/reviews")).toBe(1);
    expect(f.count("/proposals")).toBe(1);
    expect(f.count("/apply")).toBe(1);
    expect(f.count("/dismiss")).toBe(0);
    await f.check();
  });

test("Review contexts isolate history, confirmed dismissals and stale candidates", async ({
  page,
}) => {
  const f = await prepared(page, "Review context history");
  const newer = await createReview(page, f.base);
  await expect(reason(page, newer)).toHaveValue("");
  await expect(choices(page)).toHaveCount(0);
  await reason(page, newer).fill("新しいレビューだけの理由");
  const newerCandidate = await stage(page, f.base, newer, 0);
  await selectReview(page, f.review);
  await expect(reason(page, f.review)).toHaveValue("未送信の理由 A");
  await expect(choices(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await nav(page, "Export");
  await nav(page, "AI Review");
  await expect(reason(page, f.review)).toHaveValue("未送信の理由 A");
  await selectReview(page, newer);
  await expect(reason(page, newer)).toHaveValue("新しいレビューだけの理由");
  await expect(choices(page).nth(0)).toHaveAttribute("aria-pressed", "true");
  await selectReview(page, f.review);
  await page
    .locator(".review-row")
    .filter({ has: reason(page, f.review) })
    .getByRole("button", { name: "見送る", exact: true })
    .click();
  await expect(
    page.getByText("見送り済み: 未送信の理由 A", { exact: true }),
  ).toBeVisible();
  await expect(choices(page)).toHaveCount(0);
  await expect(reason(page, f.review, 1)).toHaveValue("未送信の理由 B");
  await selectReview(page, newer);
  await expect(choices(page).nth(0)).toHaveAttribute("aria-pressed", "true");
  expect(f.count("/proposals")).toBe(2);
  const saved = await f.read();
  expect(
    (
      await page.request.post(`${f.base}/foundation/save`, {
        data: {
          baseRevision: 1,
          design: { ...saved.design, radius: 9 },
          reason: "外部の設計更新",
          requestId: crypto.randomUUID(),
        },
      })
    ).ok(),
  ).toBe(true);
  // Return from Export after Query's focus refresh, keeping the old draft/base.
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await nav(page, "Export");
  await nav(page, "AI Review");
  await expect(choices(page).nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(apply(page)).toBeDisabled();
  await expect(
    page.getByText("古い結果 · 再レビューしてください", { exact: false }),
  ).toBeVisible();
  expect(
    (
      await page.request.post(`${f.base}/foundation/apply`, {
        data: { id: newerCandidate.id },
      })
    ).status(),
  ).toBe(409);
  expect((await f.read()).design.radius).toBe(9);
  await f.check();
});

for (const [action, width, fail] of [
  ["create", 1440, false],
  ["propose", 390, true],
  ["dismiss", 1440, false],
  ["apply", 390, true],
] as const)
  test(`Review ${action} ${fail ? "failure and retry" : "receipt"} stays in context through pending navigation at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const f = await prepared(page, `Review hidden ${action}`);
    const suffix =
      action === "create"
        ? "/reviews"
        : action === "propose"
          ? `/reviews/${f.review.id}/proposals`
          : action === "dismiss"
            ? `/reviews/${f.review.id}/dismiss`
            : "/foundation/apply";
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    let calls = 0;
    await page.route(`**${f.base}${suffix}`, async (route) => {
      if (route.request().method() !== "POST" || ++calls !== 1)
        return route.continue();
      const response =
        fail || action === "dismiss" ? undefined : await route.fetch();
      entered();
      await held;
      if (action === "dismiss")
        await route.fulfill({ response: await route.fetch() });
      else if (response) await route.fulfill({ response });
      else
        await route.fulfill({
          status: 503,
          json: { message: "REVIEW_CONTEXT_REJECTED" },
        });
    });
    const click = async () => {
      if (action === "create")
        await page
          .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
          .click();
      else if (action === "propose") await generate(page).click();
      else if (action === "apply") await apply(page).click();
      else
        await page
          .locator(".review-row")
          .filter({ has: reason(page, f.review) })
          .getByRole("button", { name: "見送る", exact: true })
          .click();
    };
    await click();
    await started;
    try {
      await nav(page, "Export");
      await expect(page.locator(".review-results")).toHaveCount(0);
      await nav(page, "Foundation");
      await expect(page.locator("iframe")).toHaveCount(1);
      if (action === "apply") {
        await page.getByRole("tab", { name: "Radius", exact: true }).click();
        await expect(
          page.getByRole("spinbutton", { name: "radius", exact: true }),
        ).toBeDisabled();
      }
      await nav(page, "AI Review");
      await expect(reason(page, f.review)).toHaveValue("未送信の理由 A");
      await expect(reason(page, f.review)).toBeDisabled();
      await expect(choices(page).nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(apply(page)).toBeDisabled();
    } finally {
      release();
    }
    await expect(
      page.getByRole("button", {
        name: "3画面を撮影してレビュー",
        exact: true,
      }),
    ).toBeEnabled();
    if (fail) {
      await expect(
        page.getByRole("alert").filter({ hasText: "REVIEW_CONTEXT_REJECTED" }),
      ).toBeVisible();
      await expect(choices(page).nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(reason(page, f.review)).toHaveValue("未送信の理由 A");
      expect((await f.read()).revision).toBe(1);
      await click();
      await expect(
        page.getByRole("button", {
          name: "3画面を撮影してレビュー",
          exact: true,
        }),
      ).toBeEnabled();
      expect(calls).toBe(2);
    } else expect(calls).toBe(1);
    if (action === "create") {
      const newest: Review = (
        await (await page.request.get(`${f.base}/reviews`)).json()
      )[0];
      await expect(reason(page, newest)).toHaveValue("");
      await expect(choices(page)).toHaveCount(0);
      await selectReview(page, f.review);
      await expect(reason(page, f.review)).toHaveValue("未送信の理由 A");
      await expect(choices(page).nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } else if (action === "dismiss") {
      await expect(
        page.getByText("見送り済み: 未送信の理由 A", { exact: true }),
      ).toBeVisible();
      await expect(reason(page, f.review, 1)).toHaveValue("未送信の理由 B");
      await expect(choices(page)).toHaveCount(0);
    } else if (action === "propose") {
      await expect(choices(page)).toHaveCount(2);
      await expect(choices(page).nth(1)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await expect(reason(page, f.review)).toHaveValue("未送信の理由 A");
    } else {
      await expect(page.locator(".save-status")).toContainText("設計 r2");
      await expect(choices(page)).toHaveCount(0);
      expect((await f.read()).design).toEqual(f.candidate.design);
    }
    await f.check();
  });

test("Workspace expiration drops Review context and rejects a late old-project reply", async ({
  page,
}) => {
  const bProject = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Review context project B" }, useTaste: false },
    })
  ).json();
  const a = await prepared(page, "Review context project A");
  const switchProject = page.getByRole("combobox", {
    name: "プロジェクト切り替え",
    exact: true,
  });
  await expect(
    switchProject.locator(`option[value="${bProject.id}"]`),
  ).toHaveCount(1);
  let release!: () => void, entered!: () => void, delivered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r)),
    finished = new Promise<void>((r) => (delivered = r));
  await page.route(
    `**${a.base}/reviews/${a.review.id}/proposals`,
    async (route) => {
      const response = await route.fetch();
      entered();
      await held;
      await route.fulfill({ response });
      delivered();
    },
  );
  await generate(page).click();
  await started;
  try {
    await nav(page, "プロジェクト");
    await switchProject.selectOption(bProject.id);
    const b = await prepared(page, "Review context project B", bProject);
    release();
    await finished;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(reason(page, b.review)).toHaveValue("未送信の理由 A");
    await expect(choices(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    expect(b.count("/proposals")).toBe(1);
    expect((await b.read()).revision).toBe(1);
    await page.reload();
    await expect(reason(page, b.review)).toHaveValue("");
    await expect(choices(page)).toHaveCount(0);
    await reason(page, b.review).fill("概要へ移動する前の入力");
    await nav(page, "概要・設計方針");
    await nav(page, "AI Review");
    await expect(reason(page, b.review)).toHaveValue("");
    await expect(choices(page)).toHaveCount(0);
    await nav(page, "プロジェクト");
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: a.project.brief.name,
        exact: true,
      }),
    });
    await card.getByRole("link", { name: "再開", exact: true }).click();
    await nav(page, "AI Review");
    await expect(reason(page, a.review)).toHaveValue("");
    await expect(choices(page)).toHaveCount(0);
    expect(a.count("/proposals")).toBe(2);
    expect((await a.read()).revision).toBe(1);
    await b.check();
    await a.check();
  } finally {
    release();
  }
});

test("An accepted late Review apply updates its project receipt without replacing another Workspace", async ({
  page,
}) => {
  const bProject = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Late apply project B" }, useTaste: false },
    })
  ).json();
  const a = await prepared(page, "Late apply project A");
  let release!: () => void, entered!: () => void, delivered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r)),
    finished = new Promise<void>((r) => (delivered = r));
  await page.route(`**${a.base}/foundation/apply`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    entered();
    await held;
    await route.fulfill({ response });
    delivered();
  });
  await apply(page).click();
  await started;
  try {
    await page
      .getByRole("combobox", { name: "プロジェクト切り替え", exact: true })
      .selectOption(bProject.id);
    const b = await prepared(page, "Late apply project B", bProject);
    await reason(page, b.review).fill("別プロジェクトの入力を保持");
    release();
    await finished;
    await expect(reason(page, b.review)).toHaveValue(
      "別プロジェクトの入力を保持",
    );
    await expect(choices(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".save-status")).toContainText("設計 r1");
    expect((await b.read()).revision).toBe(1);
    await nav(page, "プロジェクト");
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: a.project.brief.name,
        exact: true,
      }),
    });
    await expect(card).toContainText("設計 r2");
    await card.getByRole("link", { name: "再開", exact: true }).click();
    await expect(
      page.getByText("概要・設計方針 · 確定 r2", { exact: true }),
    ).toBeVisible();
    expect((await a.read()).design).toEqual(a.candidate.design);
    expect(a.count("/apply")).toBe(1);
    expect(b.count("/apply")).toBe(0);
    await a.check();
    await b.check();
  } finally {
    release();
  }
});
