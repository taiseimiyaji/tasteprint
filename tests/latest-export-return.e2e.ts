import { test, expect } from "@playwright/test";

test("project list latest Export opens its saved ZIP in history at 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Latest ZIP return" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  const exported = await (
    await page.request.post(`${base}/exports`, {
      data: { baseRevision: 1, bundle: true, imageMode: "omit" },
    })
  ).json();
  const saved = await (await page.request.get(base)).json();
  const updated = await page.request.post(base, {
    data: {
      baseRevision: 1,
      brief: saved.current.snapshot.brief,
      policies: [],
    },
  });
  expect(updated.ok()).toBe(true);

  let exportPosts = 0;
  let downloads = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith(`${base}/exports`) &&
      request.method() === "POST"
    )
      exportPosts++;
  });
  page.on("download", () => downloads++);
  await page.goto("/projects");
  const card = page.locator(".project-list article").filter({
    has: page.getByRole("heading", { name: "Latest ZIP return" }),
  });
  await expect(card).toContainText("設計 r2");
  await card.getByRole("link", { name: "最新Export r1" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${project.id}/export#export-${exported.id}$`),
  );
  const savedHeading = page.getByRole("heading", {
    name: /r1 · 共通の好み/,
  });
  await expect(savedHeading).toBeFocused();
  await expect(savedHeading).toBeInViewport();
  const savedZip = page.getByRole("link", {
    name: /保存済みZIPを再ダウンロード/,
  });
  await expect(savedZip).toBeInViewport();
  await expect(
    page.getByText(/このプロジェクトの確定 r2 を出力します/),
  ).toBeVisible();
  expect(exportPosts).toBe(0);
  expect(downloads).toBe(0);

  await page.goBack();
  await expect(card).toBeVisible();
  await page.goForward();
  await expect(savedHeading).toBeFocused();
  await expect(savedHeading).toBeInViewport();
  expect(exportPosts).toBe(0);
  expect(downloads).toBe(0);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});

test("missing linked Export is explained without choosing another record", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Missing latest Export" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  const exported = await (
    await page.request.post(`${base}/exports`, {
      data: { baseRevision: 1 },
    })
  ).json();
  await page.route(`**${base}/exports`, async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: [] });
    else await route.continue();
  });
  let exportPosts = 0;
  let downloads = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith(`${base}/exports`) &&
      request.method() === "POST"
    )
      exportPosts++;
  });
  page.on("download", () => downloads++);
  await page.goto("/projects");
  const card = page.locator(".project-list article").filter({
    has: page.getByRole("heading", { name: "Missing latest Export" }),
  });
  await card.getByRole("link", { name: "最新Export r1" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${project.id}/export#export-${exported.id}$`),
  );
  const missing = page.locator("#export-target-missing");
  await expect(missing).toContainText(
    "指定した保存済みExportは履歴にありません",
  );
  await expect(missing).toBeFocused();
  await expect(missing).toBeInViewport();
  await expect(page.getByRole("link", { name: /再ダウンロード/ })).toHaveCount(
    0,
  );
  expect(exportPosts).toBe(0);
  expect(downloads).toBe(0);
});

test("late history from another project does not take the target focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const first = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Late Export first" }, useTaste: false },
    })
  ).json();
  const second = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Late Export second" }, useTaste: false },
    })
  ).json();
  const firstExport = await (
    await page.request.post(`/api/projects/${first.id}/exports`, {
      data: { baseRevision: 1 },
    })
  ).json();
  const secondExport = await (
    await page.request.post(`/api/projects/${second.id}/exports`, {
      data: { baseRevision: 1 },
    })
  ).json();
  let beginFirstRead!: () => void;
  const firstRead = new Promise<void>((resolve) => (beginFirstRead = resolve));
  let releaseFirstRead!: () => void;
  const firstReadGate = new Promise<void>(
    (resolve) => (releaseFirstRead = resolve),
  );
  let finishFirstRead!: () => void;
  const firstReadDone = new Promise<void>(
    (resolve) => (finishFirstRead = resolve),
  );
  await page.route(`**/api/projects/${first.id}/exports`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    beginFirstRead();
    await firstReadGate;
    await route.continue();
    finishFirstRead();
  });
  await page.goto("/projects");
  await page
    .locator(".project-list article")
    .filter({ has: page.getByRole("heading", { name: "Late Export first" }) })
    .getByRole("link", { name: "最新Export r1" })
    .click();
  await firstRead;
  await page
    .locator("nav")
    .getByRole("link", { name: "プロジェクト", exact: true })
    .click();
  await page
    .locator(".project-list article")
    .filter({ has: page.getByRole("heading", { name: "Late Export second" }) })
    .getByRole("link", { name: "最新Export r1" })
    .click();
  const secondHeading = page.locator(`#export-${secondExport.id}`);
  await expect(secondHeading).toBeFocused();
  releaseFirstRead();
  await firstReadDone;
  await expect(secondHeading).toBeFocused();
  await expect(page.locator(`#export-${firstExport.id}`)).toHaveCount(0);
  await expect(page).toHaveURL(
    new RegExp(`/projects/${second.id}/export#export-${secondExport.id}$`),
  );
});
