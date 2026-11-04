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
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute("aria-expanded")) === "false"
  )
    await menu.click();
}
async function exportStep(page: Page) {
  await openMenu(page);
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
}
async function switchProject(page: Page, id: string) {
  await openMenu(page);
  await page.getByLabel("プロジェクト切り替え").selectOption(id);
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/overview$`));
}

for (const width of [1440, 390]) {
  for (const historyFails of [false, true]) {
    test(`file failure allows saved ZIP retry while history is pending at ${width}px; historyFails=${historyFails}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const a = await create(
        page,
        `Pending file recovery ${width} ${historyFails}`,
      );
      const b = await create(page, "Unrelated export project");
      const base = `/api/projects/${a.id}`;
      const probe = `/api/e2e-fail-export-download/${a.id}`;
      expect((await page.request.post(probe)).ok()).toBe(true);
      let posts = 0,
        reads = 0,
        files = 0;
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => (enter = resolve));
      const held = new Promise<void>((resolve) => (release = resolve));
      let holdFirstRead = true;
      let failRead = historyFails;
      page.on("request", (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname.startsWith(`${base}/exports/`)
        )
          files++;
      });
      const downloads: string[] = [];
      page.on("download", (download) =>
        downloads.push(download.suggestedFilename()),
      );
      await page.route(`**${base}/exports`, async (route) => {
        if (route.request().method() === "POST") {
          posts++;
          return route.continue();
        }
        if (posts && holdFirstRead) {
          holdFirstRead = false;
          reads++;
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          enter();
          await held;
          return historyFails
            ? route.fulfill({
                status: 503,
                json: { message: "HISTORY_READ_UNAVAILABLE" },
              })
            : route.fulfill({ response });
        }
        if (posts) reads++;
        // Keep the outage through Query's existing automatic read retry.
        if (posts && failRead)
          return route.fulfill({
            status: 503,
            json: { message: "HISTORY_READ_UNAVAILABLE" },
          });
        return route.continue();
      });
      const initialHistory = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${base}/exports` &&
          response.request().method() === "GET",
      );
      await page.goto(`/projects/${a.id}/export`);
      await (await initialHistory).finished();
      const generate = page.getByRole("button", {
        name: "画像なし ZIP を生成",
        exact: true,
      });
      const zip = page.getByRole("link", {
        name: /保存済みZIPを再ダウンロード/,
      });
      const fileError = page.getByRole("alert").filter({
        hasText: "isolated download failure",
      });
      try {
        await generate.click();
        await entered;
        const stored = await (await page.request.get(`${base}/exports`)).json();
        expect(stored).toHaveLength(1);
        await expect(zip).toBeVisible();
        expect(posts).toBe(1);
        expect(files).toBe(1);
        expect(reads).toBe(1);
        expect(downloads).toEqual([]);
        // The original file error and retry must not wait for this read.
        await expect(fileError).toContainText("ダウンロードに失敗");
        await expect(generate).toBeEnabled();
        await expect(zip).toHaveAttribute("aria-disabled", "false");
        await expect(
          page.getByText("Export履歴を取得中…", { exact: true }),
        ).toBeVisible();

        if (historyFails) {
          release();
          const historyError = page.getByRole("alert").filter({
            hasText: "HISTORY_READ_UNAVAILABLE",
          });
          await expect(historyError).toBeVisible();
          await expect(fileError).toBeVisible();
          await expect(zip).toHaveAttribute("aria-disabled", "false");
          failRead = false;
          await page
            .getByRole("button", { name: "Export履歴を再取得", exact: true })
            .click();
          await expect(historyError).toHaveCount(0);
          await expect(fileError).toBeVisible();
          expect(posts).toBe(1);
        }
        expect((await page.request.delete(probe)).ok()).toBe(true);
        const fileName = Object.keys(stored[0].files).find((name) =>
          name.endsWith(".zip"),
        )!;
        const expected = await page.request.get(
          `${base}/exports/${stored[0].id}/${encodeURIComponent(fileName)}`,
        );
        expect(expected.ok()).toBe(true);
        const expectedBytes = await expected.body();
        const download = page.waitForEvent("download");
        await zip.click();
        const bytes = await readFile((await (await download).path())!);
        expect(bytes.equals(expectedBytes)).toBe(true);
        const bundle = unzipSync(bytes);
        const designFile = Object.keys(bundle).find((name) =>
          name.endsWith("/design-system.json"),
        )!;
        const exported = JSON.parse(Buffer.from(bundle[designFile]).toString());
        expect(exported.projectId).toBe(a.id);
        expect(exported.revision).toBe(1);
        await expect(fileError).toHaveCount(0);
        await expect(generate).toBeEnabled();
        expect(posts).toBe(1);
        expect(files).toBe(2);
        expect(downloads).toHaveLength(1);
        if (!historyFails) expect(reads).toBe(1);

        await switchProject(page, b.id);
        await exportStep(page);
        await expect(zip).toHaveCount(0);
        await expect(fileError).toHaveCount(0);
        await expect(generate).toBeEnabled();
        // A late source history reply must not alter the destination project.
        const lateRead = !historyFails
          ? page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname === `${base}/exports` &&
                response.request().method() === "GET",
            )
          : null;
        release();
        if (lateRead) await (await lateRead).finished();
        await expect(page.getByLabel("プロジェクト切り替え")).toHaveValue(b.id);
        await expect(zip).toHaveCount(0);
        expect(downloads).toHaveLength(1);
        expect(posts).toBe(1);
        expect(
          await (
            await page.request.get(`/api/projects/${b.id}/exports`)
          ).json(),
        ).toHaveLength(0);
        await switchProject(page, a.id);
        await exportStep(page);
        await expect(zip).toBeVisible();
        await expect(zip).toHaveAttribute(
          "href",
          `${base}/exports/${stored[0].id}/${encodeURIComponent(fileName)}`,
        );
        expect(
          await (await page.request.get(`${base}/exports`)).json(),
        ).toHaveLength(1);
        expect(posts).toBe(1);
        expect(
          (await (await page.request.get("/api/health")).json()).codexCalls,
        ).toBe(0);
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    });
  }
}
