import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function create(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
}

test("a completed Export stays in its project after switching before the POST reply", async ({
  page,
}) => {
  const a = await create(page, "Export switch source A");
  const b = await create(page, "Export switch destination B");
  const baseA = `/api/projects/${a.id}`;
  const baseB = `/api/projects/${b.id}`;
  const wrongFileRequests: string[] = [];
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith(`${baseA}/exports/`) &&
      request.method() === "GET"
    )
      wrongFileRequests.push(request.url());
  });
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (entered = resolve));
  let postsA = 0;
  await page.route(`**${baseA}/exports`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    postsA++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    entered();
    await held;
    await route.fulfill({ response });
  });
  await page.goto(`/projects/${a.id}/export`);
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await started;
  await page.getByLabel("プロジェクト切り替え").selectOption(b.id);
  await page.waitForURL(`**/projects/${b.id}/overview`);
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await page.waitForURL(`**/projects/${b.id}/export`);
  await expect(page.getByLabel("プロジェクト切り替え")).toHaveValue(b.id);
  const accepted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${baseA}/exports` &&
      response.request().method() === "POST",
  );
  release();
  expect((await accepted).ok()).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(wrongFileRequests).toEqual([]);
  expect(downloads).toEqual([]);
  expect(postsA).toBe(1);
  expect(
    await (await page.request.get(`${baseA}/exports`)).json(),
  ).toHaveLength(1);
  expect(
    await (await page.request.get(`${baseB}/exports`)).json(),
  ).toHaveLength(0);
  await page.getByLabel("プロジェクト切り替え").selectOption(a.id);
  await page.waitForURL(`**/projects/${a.id}/overview`);
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  const history = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Export履歴" }),
  });
  const savedFile = history.getByRole("link", { name: /\.json$/ });
  await expect(savedFile).toBeVisible();
  const download = page.waitForEvent("download");
  await savedFile.click();
  const exported = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(exported.projectId).toBe(a.id);
  expect(postsA).toBe(1);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});

test("a pending Export file response does not download after switching projects", async ({
  page,
}) => {
  const a = await create(page, "Export file source A");
  const b = await create(page, "Export file destination B");
  const baseA = `/api/projects/${a.id}`;
  const baseB = `/api/projects/${b.id}`;
  let enter!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (enter = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  await page.route(`**${baseA}/exports/*/*`, async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    enter();
    await held;
    await route.fulfill({ response });
  });
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );

  await page.goto(`/projects/${a.id}/export`);
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await started;
  await page.getByLabel("プロジェクト切り替え").selectOption(b.id);
  await page.waitForURL(`**/projects/${b.id}/overview`);
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await page.waitForURL(`**/projects/${b.id}/export`);
  const delivered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${baseA}/exports/`) &&
      response.request().method() === "GET",
  );
  release();
  expect((await delivered).ok()).toBe(true);
  // The old fetch continuation can run after the response event.
  await page.waitForTimeout(500);
  expect(downloads).toEqual([]);
  expect(
    await (await page.request.get(`${baseA}/exports`)).json(),
  ).toHaveLength(1);
  expect(
    await (await page.request.get(`${baseB}/exports`)).json(),
  ).toHaveLength(0);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
