import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";

async function create(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
}
async function openMenu(page: Page) {
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  if (await menu.isVisible()) {
    if ((await menu.getAttribute("aria-expanded")) === "false")
      await menu.click();
  }
}
async function step(page: Page, name: string) {
  await openMenu(page);
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name, exact: true })
    .click();
}
async function switchProject(page: Page, id: string) {
  await openMenu(page);
  await page.getByLabel("プロジェクト切り替え").selectOption(id);
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/overview$`));
}
async function fixture(page: Page, name: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  // Recovery must work while the successful empty history is still fresh.
  await page.clock.setFixedTime(new Date("2026-11-04T00:00:00Z"));
  const a = await create(page, name);
  const b = await create(page, `${name} other`);
  const base = `/api/projects/${a.id}`;
  const current = (await (await page.request.get(`${base}/foundation`)).json())
    .current;
  const saved = await page.request.post(`${base}/foundation/save`, {
    data: {
      baseRevision: current.revision,
      design: { ...current.design, accent: "#526f99" },
      reason: "Saved fixture",
      requestId: crypto.randomUUID(),
    },
  });
  expect(saved.ok()).toBe(true);
  await page.goto(`/projects/${a.id}/foundation`);
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#b45309");
  const initialRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${base}/exports` &&
      response.request().method() === "GET",
  );
  await step(page, "Export");
  await (await initialRead).finished();
  await expect(
    page.getByText(
      "このプロジェクトの確定 r2 を出力します。未保存の編集は含みません。",
      { exact: true },
    ),
  ).toBeVisible();
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  return {
    a,
    b,
    base,
    downloads,
    zip: page.getByRole("link", { name: /保存済みZIPを再ダウンロード/ }),
    generate: page.getByRole("button", {
      name: "画像なし ZIP を生成",
      exact: true,
    }),
  };
}
function verifyZip(bytes: Buffer, projectId: string) {
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((name) =>
    name.endsWith("/design-system.json"),
  )!;
  const exported = JSON.parse(Buffer.from(files[name]).toString());
  expect(exported.projectId).toBe(projectId);
  expect(exported.revision).toBe(2);
  expect(exported.design.accent).toBe("#526f99");
}
async function verifyDraft(page: Page, base: string) {
  await step(page, "Foundation");
  const accent = page.getByRole("textbox", { name: "accent", exact: true });
  await expect(accent).toHaveValue("#b45309");
  await page.reload();
  await expect(accent).toHaveValue("#b45309");
  await expect(page.locator(".editor-actions")).toContainText(
    "下書き・未保存 · 設計 r2",
  );
  expect(
    (await (await page.request.get(`${base}/foundation`)).json()).current
      .revision,
  ).toBe(2);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
}

for (const width of [1440, 390]) {
  for (const accepted of [true, false]) {
    test(`Export missing receipt accepted=${accepted} recovers history, retry and draft at ${width}px`, async ({
      page,
    }) => {
      const name = `Receipt ${accepted} ${width}`;
      const f = await fixture(page, name, width);
      let posts = 0,
        reads = 0;
      let acceptedId: string | undefined;
      await page.route(`**${f.base}/exports`, async (route) => {
        if (route.request().method() !== "POST") {
          reads++;
          return route.continue();
        }
        posts++;
        if (posts === 1) {
          if (accepted) {
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
            acceptedId = (await response.json()).id;
          }
          return route.fulfill({
            status: 503,
            json: { message: "RECEIPT_UNAVAILABLE" },
          });
        }
        return route.continue();
      });
      await f.generate.click();
      await expect(
        page.getByRole("alert").filter({ hasText: "RECEIPT_UNAVAILABLE" }),
      ).toBeVisible();
      await expect.poll(() => reads).toBeGreaterThan(0);
      const stored = await (await page.request.get(`${f.base}/exports`)).json();
      expect(stored).toHaveLength(accepted ? 1 : 0);
      expect(f.downloads).toEqual([]);

      await switchProject(page, f.b.id);
      await step(page, "Export");
      await expect(f.zip).toHaveCount(0);
      await expect(
        page.getByRole("alert").filter({ hasText: "RECEIPT_UNAVAILABLE" }),
      ).toHaveCount(0);
      await switchProject(page, f.a.id);
      await step(page, "Export");
      if (accepted) await expect(f.zip).toBeVisible();
      else await expect(f.zip).toHaveCount(0);
      expect(posts).toBe(1);

      await openMenu(page);
      await page
        .getByRole("navigation", { name: "アプリ全体" })
        .getByRole("link", { name: "プロジェクト", exact: true })
        .click();
      const card = page
        .locator(".project-list article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      const latest = card.getByRole("link", {
        name: "最新Export r2",
        exact: true,
      });
      if (accepted) {
        await expect(latest).toHaveAttribute(
          "href",
          new RegExp(`#export-${acceptedId}$`),
        );
        await latest.click();
      } else {
        await expect(latest).toHaveCount(0);
        await card.getByRole("link", { name: /を再開$/ }).click();
        await step(page, "Export");
      }
      expect(posts).toBe(1);
      expect(f.downloads).toEqual([]);
      let firstBytes: Buffer | undefined;
      if (accepted) {
        const downloaded = page.waitForEvent("download");
        await f.zip.click();
        firstBytes = await readFile((await (await downloaded).path())!);
        verifyZip(firstBytes, f.a.id);
      }
      // Only this explicit second generation request may POST again.
      const retried = page.waitForEvent("download");
      await f.generate.click();
      const bytes = await readFile((await (await retried).path())!);
      verifyZip(bytes, f.a.id);
      if (firstBytes) expect(bytes).toEqual(firstBytes);
      const after = await (await page.request.get(`${f.base}/exports`)).json();
      expect(after).toHaveLength(1);
      if (accepted) expect(after[0].id).toBe(acceptedId);
      expect(posts).toBe(2);
      expect(
        await (
          await page.request.get(`/api/projects/${f.b.id}/exports`)
        ).json(),
      ).toHaveLength(0);
      await verifyDraft(page, f.base);
    });
  }

  test(`Export missing receipt preserves both errors and recovers failed history with GET only at ${width}px`, async ({
    page,
  }) => {
    const f = await fixture(page, `Receipt GET recovery ${width}`, width);
    let posts = 0,
      failRead = false;
    await page.route(`**${f.base}/exports`, async (route) => {
      if (route.request().method() === "GET") {
        if (failRead)
          return route.fulfill({
            status: 503,
            json: { message: "HISTORY_UNAVAILABLE" },
          });
        return route.continue();
      }
      posts++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      failRead = true;
      return route.fulfill({
        status: 503,
        json: { message: "RECEIPT_UNAVAILABLE" },
      });
    });
    await f.generate.click();
    const postError = page
      .getByRole("alert")
      .filter({ hasText: "RECEIPT_UNAVAILABLE" });
    const readError = page
      .getByRole("alert")
      .filter({ hasText: "HISTORY_UNAVAILABLE" });
    await expect(postError).toBeVisible();
    await expect(readError).toBeVisible();
    expect(f.downloads).toEqual([]);
    expect(
      await (await page.request.get(`${f.base}/exports`)).json(),
    ).toHaveLength(1);
    failRead = false;
    await page
      .getByRole("button", { name: "Export履歴を再取得", exact: true })
      .click();
    await expect(readError).toHaveCount(0);
    await expect(postError).toBeVisible();
    await expect(f.zip).toBeVisible();
    expect(posts).toBe(1);
    expect(f.downloads).toEqual([]);
    const downloaded = page.waitForEvent("download");
    await f.zip.click();
    verifyZip(await readFile((await (await downloaded).path())!), f.a.id);
    expect(posts).toBe(1);
    await verifyDraft(page, f.base);
  });
}

test("an aborted Export receipt on another project recovers the source history on revisit", async ({
  page,
}) => {
  const f = await fixture(page, "Late missing receipt", 390);
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route(`**${f.base}/exports`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    enter();
    await held;
    await route.abort("failed");
  });
  try {
    await f.generate.click();
    await started;
    await switchProject(page, f.b.id);
    await step(page, "Export");
    const delivered = page.waitForEvent(
      "requestfailed",
      (request) =>
        new URL(request.url()).pathname === `${f.base}/exports` &&
        request.method() === "POST",
    );
    release();
    await delivered;
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(f.zip).toHaveCount(0);
    expect(f.downloads).toEqual([]);
    await switchProject(page, f.a.id);
    await step(page, "Export");
    await expect(f.zip).toBeVisible();
    expect(posts).toBe(1);
    expect(f.downloads).toEqual([]);
    expect(
      await (await page.request.get(`/api/projects/${f.b.id}/exports`)).json(),
    ).toHaveLength(0);
    await verifyDraft(page, f.base);
  } finally {
    release();
  }
});
