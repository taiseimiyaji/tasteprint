import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const input = (name: string, url = "https://example.com/e2e-pending") => ({
  name,
  url,
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
async function scopeFor(page: Page, profile: boolean, name: string) {
  if (profile) return { base: "/api/profile/references", path: "/profile" };
  const response = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  const p = await response.json();
  return {
    base: `/api/projects/${p.id}/references`,
    path: `/projects/${p.id}/inspiration`,
  };
}
async function visit(page: Page, path: string, profile: boolean) {
  await page.goto(path);
  if (profile)
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
}
async function navigate(page: Page, name: string, width: number) {
  if (width === 390)
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("link", { name, exact: true }).click();
}
async function cleanup(page: Page, base: string, id: string) {
  const ref = (await (await page.request.get(base)).json()).references.find(
    (r: { id: string }) => r.id === id,
  );
  if (ref)
    expect(
      (
        await page.request.delete(`${base}/${id}`, {
          data: { version: ref.version },
        })
      ).ok(),
    ).toBe(true);
}
function cardFor(page: Page, name: string) {
  return page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}
const cases = [
  { profile: true, width: 1440, clock: "equal" },
  { profile: false, width: 390, clock: "equal" },
  { profile: true, width: 390, clock: "reversed" },
  { profile: false, width: 1440, clock: "reversed" },
] as const;
for (const { profile, width, clock } of cases) {
  const label = `${profile ? "Profile" : "Project"}-${clock}-${width}`;
  test(`${label} preserves latest failed job when a canceled reply arrives after it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const scope = await scopeFor(page, profile, label);
    const refInput = input(label);
    const created = await page.request.post(scope.base, { data: refInput });
    expect(created.ok()).toBe(true);
    const ref = await created.json();
    const a = await (
      await page.request.post(`${scope.base}/${ref.id}/jobs`, {
        data: { version: 1, type: "capture", key: crypto.randomUUID() },
      })
    ).json();
    let fail = false,
      release!: () => void,
      entered!: () => void,
      posts = 0;
    const held = new Promise<void>((resolve) => (release = resolve)),
      entry = new Promise<void>((resolve) => (entered = resolve));
    const timestamp = (job: { id: string }) =>
      clock === "equal"
        ? "2026-10-04T00:00:00.000Z"
        : job.id === a.id
          ? "2099-01-01T00:00:00.000Z"
          : "1970-01-01T00:00:00.000Z";
    page.on("request", (r) => {
      if (
        new URL(r.url()).pathname.startsWith(scope.base) &&
        r.method() !== "GET"
      )
        posts++;
    });
    await page.route(`**${scope.base}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (fail)
        return route.fulfill({
          status: 503,
          json: { message: "Job order GET failure" },
        });
      const response = await route.fetch(),
        data = await response.json();
      data.jobs = data.jobs.map((job: { id: string }) => ({
        ...job,
        createdAt: timestamp(job),
      }));
      await route.fulfill({ response, json: data });
    });
    await page.route(`**${scope.base}/jobs/${a.id}/cancel`, async (route) => {
      const response = await route.fetch(),
        data = await response.json();
      expect(data.state).toBe("canceled");
      entered();
      await held;
      await route.fulfill({
        response,
        json: { ...data, createdAt: timestamp(data) },
      });
    });
    const card = cardFor(page, label);
    try {
      await visit(page, scope.path, profile);
      await expect(card.getByRole("status")).toContainText("URL取得: 処理中");
      await card.getByRole("button", { name: "中断する", exact: true }).click();
      await entry;
      const updated = await page.request.patch(`${scope.base}/${ref.id}`, {
        data: { ...refInput, url: "https://example.com/failure", version: 1 },
      });
      expect(updated.ok()).toBe(true);
      const version = (await updated.json()).version;
      const b = await (
        await page.request.post(`${scope.base}/${ref.id}/jobs`, {
          data: { version, type: "capture", key: crypto.randomUUID() },
        })
      ).json();
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(`${scope.base}/jobs/${b.id}`)
              ).json()
            ).job.state,
        )
        .toBe("failed");
      if (!profile) {
        await navigate(page, "概要・設計方針", width);
        await navigate(page, "Inspiration", width);
      }
      await expect(card.getByRole("status")).toContainText("URL取得: 失敗");
      await expect(card.getByRole("status")).toContainText("30秒以内");
      fail = true;
      release();
      await expect(page.getByRole("alert")).toContainText(
        "参考一覧の読み込みに失敗",
      );
      await expect(card.getByRole("status")).toContainText("URL取得: 失敗");
      await expect(card.getByRole("status")).toContainText("30秒以内");
      const retry = page.getByRole("button", {
        name: "一覧を再取得",
        exact: true,
      });
      await expect(retry).toBeEnabled();
      const before = posts;
      fail = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(posts).toBe(before);
      await expect(card.getByRole("status")).toContainText("URL取得: 失敗");
      await page.reload();
      if (profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      await expect(card.getByRole("status")).toContainText("URL取得: 失敗");
      const stored = await (await page.request.get(scope.base)).json();
      const pair = stored.jobs.filter(
        (j: { id: string }) => j.id === a.id || j.id === b.id,
      );
      expect(pair.map((j: { id: string }) => j.id)).toEqual([a.id, b.id]);
      expect(pair[1].createdSequence).toBeGreaterThan(pair[0].createdSequence);
      mkdirSync("../evidence/reference-order-ui", { recursive: true });
      await page.screenshot({
        path: `../evidence/reference-order-ui/${label}.png`,
        fullPage: true,
      });
      writeFileSync(
        `../evidence/reference-order-ui/${label}.json`,
        JSON.stringify(
          {
            clockFixture: `${clock} createdAt DTO only`,
            jobs: pair,
            displayed: await card.getByRole("status").innerText(),
            posts,
            pageErrors: errors,
          },
          null,
          2,
        ),
      );
      expect(posts).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      release();
      await cleanup(page, scope.base, ref.id);
    }
  });
}
for (const { profile, width } of [
  { profile: true, width: 390 },
  { profile: false, width: 1440 },
]) {
  const label = `${profile ? "Profile" : "Project"}-transition-${width}`;
  test(`${label} accepted cancellation stays editable despite backwards updatedAt and GET failure`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const scope = await scopeFor(page, profile, label);
    const ref = await (
      await page.request.post(scope.base, { data: input(label) })
    ).json();
    const a = await (
      await page.request.post(`${scope.base}/${ref.id}/jobs`, {
        data: { version: 1, type: "capture", key: crypto.randomUUID() },
      })
    ).json();
    let fail = false,
      posts = 0;
    page.on("request", (r) => {
      if (
        new URL(r.url()).pathname.startsWith(scope.base) &&
        r.method() !== "GET"
      )
        posts++;
    });
    await page.route(`**${scope.base}`, async (route) => {
      if (route.request().method() === "GET" && fail)
        return route.fulfill({
          status: 503,
          json: { message: "Job transition GET failure" },
        });
      await route.continue();
    });
    await page.route(`**${scope.base}/jobs/${a.id}/cancel`, async (route) => {
      const response = await route.fetch(),
        data = await response.json();
      expect(data.state).toBe("canceled");
      fail = true;
      await route.fulfill({
        response,
        json: { ...data, updatedAt: "1970-01-01T00:00:00.000Z" },
      });
    });
    const card = cardFor(page, label);
    try {
      await visit(page, scope.path, profile);
      await expect(card.getByRole("status")).toContainText("URL取得: 処理中");
      await card.getByRole("button", { name: "中断する", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText(
        "参考一覧の読み込みに失敗",
      );
      await expect(card.getByRole("status")).toContainText("URL取得: 中断済み");
      await expect(
        card.getByRole("button", { name: "中断する", exact: true }),
      ).toHaveCount(0);
      await expect(
        card.getByRole("button", { name: "URLを再取得", exact: true }),
      ).toBeEnabled();
      const likes = card.getByRole("textbox", {
        name: "好きな点",
        exact: true,
      });
      await expect(likes).toBeEditable();
      await likes.fill("Retained canceled-job notes");
      const before = posts;
      fail = false;
      const retry = page.getByRole("button", {
        name: "一覧を再取得",
        exact: true,
      });
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(posts).toBe(before);
      await expect(likes).toHaveValue("Retained canceled-job notes");
      await page.reload();
      if (profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      await expect(card.getByRole("status")).toContainText("URL取得: 中断済み");
      await expect(likes).toHaveValue("Retained canceled-job notes");
      const actual = (
        await (await page.request.get(`${scope.base}/jobs/${a.id}`)).json()
      ).job;
      expect(actual.state).toBe("canceled");
      expect(actual.transitionSequence).toBeGreaterThan(a.transitionSequence);
      mkdirSync("../evidence/reference-order-ui", { recursive: true });
      await page.screenshot({
        path: `../evidence/reference-order-ui/${label}.png`,
        fullPage: true,
      });
      writeFileSync(
        `../evidence/reference-order-ui/${label}.json`,
        JSON.stringify(
          {
            clockFixture: "reversed updatedAt cancellation DTO only",
            job: actual,
            displayed: await card.getByRole("status").innerText(),
            posts,
            pageErrors: errors,
          },
          null,
          2,
        ),
      );
      expect(posts).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await cleanup(page, scope.base, ref.id);
    }
  });
}
