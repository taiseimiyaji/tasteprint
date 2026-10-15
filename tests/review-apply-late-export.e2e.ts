import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a late Review apply receipt preserves a newer revision already read by Export", async ({
  page,
}) => {
  test.setTimeout(120000);
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Late Review apply probe" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  await page.goto(`/projects/${project.id}/review`);
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await expect(page.getByText("要判断の指摘数:", { exact: false })).toBeVisible(
    { timeout: 90000 },
  );
  await page.getByRole("button", { name: "修正案を作成", exact: true }).click();
  await page
    .getByRole("button", { name: /仮Preview:/ })
    .first()
    .click();

  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (enter = resolve));
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${base}/foundation/apply`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    enter();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "まとめて適用", exact: true }).click();
  await entered;
  try {
    const r2 = (await (await page.request.get(`${base}/foundation`)).json())
      .current;
    expect(r2.revision).toBe(2);
    const newer = await page.request.post(`${base}/foundation/save`, {
      data: {
        baseRevision: 2,
        design: { ...r2.design, accent: "#445566" },
        reason: "another tab",
        requestId: crypto.randomUUID(),
      },
    });
    expect(newer.ok()).toBe(true);
    await page
      .getByRole("navigation", { name: "プロジェクトの設計" })
      .getByRole("link", { name: "Export", exact: true })
      .click();
    await expect(
      page.getByText(
        "このプロジェクトの確定 r3 を出力します。未保存の編集は含みません。",
      ),
    ).toBeVisible();
    let failedReads = 0;
    await page.route(`**${base}`, async (route) => {
      if (route.request().method() === "GET") {
        failedReads++;
        await route.fulfill({
          status: 503,
          json: { message: "offline after apply" },
        });
      } else await route.continue();
    });
    release();
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem(`tasteprint.scope.${id}.draft.v1`)!)
              .baseRevision,
          project.id,
        ),
      )
      .toBe(2);
    await expect.poll(() => failedReads).toBeGreaterThan(0);
    expect(
      (await (await page.request.get(`${base}/foundation`)).json()).current
        .revision,
    ).toBe(3);
    await expect(
      page.getByText(
        "このプロジェクトの確定 r3 を出力します。未保存の編集は含みません。",
      ),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    const exported = JSON.parse(
      await readFile((await (await download).path())!, "utf8"),
    );
    expect(exported.revision).toBe(3);
    expect(exported.design.accent).toBe("#445566");
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  } finally {
    release();
  }
});
