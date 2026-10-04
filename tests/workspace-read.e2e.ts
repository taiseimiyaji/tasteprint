import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function project(page: Page, name: string) {
  return (
    await (
      await page.request.post("/api/projects", {
        data: { brief: { name }, useTaste: false },
      })
    ).json()
  ).id as string;
}
async function holdNextRead(page: Page, id: string, failure: boolean) {
  let release!: () => void;
  let ready!: () => void;
  let delivered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (ready = resolve));
  const finished = new Promise<void>((resolve) => (delivered = resolve));
  let first = true;
  await page.route(`**/api/projects/${id}/foundation`, async (route) => {
    if (!first || route.request().method() !== "GET") return route.continue();
    first = false;
    const response = await route.fetch();
    ready();
    await gate;
    try {
      if (failure)
        await route.fulfill({
          status: 503,
          json: { message: "古い設計読取の失敗" },
        });
      else await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  return {
    started,
    release,
    finish: async () => {
      release();
      await finished;
      // Let the delivered fetch and React's queued state updates reach the DOM.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    },
  };
}
async function nextSaveAndExport(page: Page, id: string, revision: number) {
  await page
    .locator("nav")
    .getByRole("link", { name: "Preview", exact: true })
    .click();
  const radius = page.getByRole("slider", { name: "角丸", exact: true });
  await radius.focus();
  await radius.press("ArrowRight");
  const value = Number(await radius.inputValue());
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.locator(".editor-actions")).toContainText(
    `保存済み · 設計 r${revision}`,
  );
  await expect(radius).toBeEnabled();
  await page
    .locator("nav")
    .getByRole("link", { name: "Export", exact: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const path = await (await downloaded).path();
  const data = JSON.parse(await readFile(path!, "utf8"));
  expect(data.projectId).toBe(id);
  expect(data.revision).toBe(revision);
  expect(data.design.radius).toBe(value);
  await page
    .locator("nav")
    .getByRole("link", { name: "Preview", exact: true })
    .click();
  await page.reload();
  await expect(radius).toHaveValue(String(value));
  await expect(page.locator(".editor-actions")).toContainText(
    `保存済み · 設計 r${revision}`,
  );
}

for (const outcome of ["success", "failure"] as const) {
  for (const readFailure of [false, true]) {
    test(`Workspace ${outcome} keeps its result when an older GET ${readFailure ? "fails" : "succeeds"}`, async ({
      page,
    }) => {
      const id = await project(page, `Workspace ${outcome} ${readFailure}`);
      await page.goto(`/projects/${id}/foundation`);
      await expect(page.getByText(/確定履歴（revision 1/)).toBeVisible();
      const read = await holdNextRead(page, id, readFailure);
      const endpoint = `**/api/projects/${id}/foundation/save`;
      if (outcome === "failure")
        await page.route(endpoint, (route) =>
          route.fulfill({
            status: 500,
            json: { message: "直近の設計保存失敗" },
          }),
        );
      try {
        await page
          .locator("nav")
          .getByRole("link", { name: "Preview", exact: true })
          .click();
        await read.started;
        const radius = page.getByRole("slider", { name: "角丸", exact: true });
        await radius.focus();
        await radius.press("ArrowRight");
        const value = Number(await radius.inputValue());
        await page
          .getByRole("button", { name: "変更を保存", exact: true })
          .click();
        if (outcome === "success")
          await expect(page.locator(".editor-actions")).toContainText(
            "保存済み · 設計 r2",
          );
        else
          await expect(
            page.locator(".editor-actions").getByRole("alert"),
          ).toContainText("直近の設計保存失敗");
        await expect(radius).toBeEnabled();
        await read.finish();
        await expect(radius).toHaveValue(String(value));
        if (outcome === "success") {
          await expect(page.locator(".editor-actions")).toContainText(
            "保存済み · 設計 r2",
          );
          await expect(
            page.locator(".editor-actions").getByRole("alert"),
          ).toHaveCount(0);
        } else {
          await expect(
            page.locator(".editor-actions").getByRole("alert"),
          ).toContainText("直近の設計保存失敗");
          await expect(
            page.getByRole("button", { name: "変更を保存", exact: true }),
          ).toBeEnabled();
          await page.unroute(endpoint);
          await page
            .getByRole("button", { name: "変更を保存", exact: true })
            .click();
          await expect(page.locator(".editor-actions")).toContainText(
            "保存済み · 設計 r2",
          );
        }
        const server = (
          await (
            await page.request.get(`/api/projects/${id}/foundation`)
          ).json()
        ).current;
        expect(server.revision).toBe(2);
        expect(server.design.radius).toBe(value);
        await nextSaveAndExport(page, id, 3);
      } finally {
        read.release();
      }
    });
  }
}

for (const outcome of ["success", "failure"] as const) {
  test(`Review ${outcome} ignores a read begun during apply after navigation`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const id = await project(page, `Review read ${outcome}`);
    await page.goto(`/projects/${id}/review`);
    await page
      .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
      .click();
    await expect(
      page.getByText("要判断の指摘数:", { exact: false }),
    ).toBeVisible({ timeout: 90000 });
    await page
      .getByRole("button", { name: "修正案を作成", exact: true })
      .click();
    await page
      .getByRole("button", { name: "仮Preview:", exact: false })
      .first()
      .click();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      `**/api/projects/${id}/foundation/apply`,
      async (route) => {
        await gate;
        if (outcome === "failure")
          await route.fulfill({
            status: 500,
            json: { message: "Review適用失敗" },
          });
        else await route.continue();
      },
    );
    const read = await holdNextRead(page, id, outcome === "failure");
    try {
      await page
        .getByRole("button", { name: "まとめて適用", exact: true })
        .click();
      await page
        .locator("nav")
        .getByRole("link", { name: "Foundation", exact: true })
        .click();
      await read.started;
      release();
      const revision = outcome === "success" ? 2 : 1;
      await expect(page.locator(".editor-actions")).toContainText(
        `保存済み · 設計 r${revision}`,
      );
      await expect(
        page.getByRole("textbox", { name: "accent", exact: true }),
      ).toBeEnabled();
      await read.finish();
      await expect(page.locator(".editor-actions")).toContainText(
        `保存済み · 設計 r${revision}`,
      );
      await expect(
        page.locator(".editor-actions").getByRole("alert"),
      ).toHaveCount(0);
      await nextSaveAndExport(page, id, revision + 1);
    } finally {
      release();
      read.release();
    }
  });
}
