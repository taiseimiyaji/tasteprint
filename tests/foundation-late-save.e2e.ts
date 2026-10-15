import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a late save receipt cannot replace a newer revision already read by Export", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Late save receipt" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (entered = resolve));
  await page.route(`**${base}/foundation/save`, async (route) => {
    const response = await route.fetch();
    entered();
    await held;
    await route.fulfill({ response });
  });

  await page.goto(`/projects/${project.id}/foundation`);
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#112233");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await started;
  try {
    const current = (
      await (await page.request.get(`${base}/foundation`)).json()
    ).current;
    expect(current.revision).toBe(2);
    const newer = await page.request.post(`${base}/foundation/save`, {
      data: {
        baseRevision: current.revision,
        design: { ...current.design, accent: "#445566" },
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
          json: { message: "offline after save" },
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
  } finally {
    release();
  }
});
