import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import type { TasteSnapshot } from "../src/domain/projects";

let restore: TasteSnapshot | undefined;
test.afterEach(async ({ request }) => {
  if (!restore) return;
  const snapshot = restore;
  restore = undefined;
  const current = (await (await request.get("/api/profile")).json()).current;
  expect(
    (
      await request.post("/api/profile", {
        data: { ...snapshot, baseProfileRevision: current.revision },
      })
    ).ok(),
  ).toBe(true);
});
for (const width of [1440, 390]) {
  test(`Overview refuses an over-limit merge without saving and exports an edited 100-principle retry at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const initial = (await (await page.request.get("/api/profile")).json())
      .current;
    restore = initial.snapshot;
    const prefix = crypto.randomUUID();
    const principles = Array.from({ length: 100 }, (_, i) => ({
      id: `${prefix}-${i}`,
      target: "density",
      text: `行の原則 ${i}`,
      reason: "比較する",
      sources: ["明示的な入力"],
      locked: false,
    }));
    const firstResponse = await page.request.post("/api/profile", {
      data: {
        ...initial.snapshot,
        baseProfileRevision: initial.revision,
        principles,
      },
    });
    expect(firstResponse.ok()).toBe(true);
    const first = await firstResponse.json();
    const created = await page.request.post("/api/projects", {
      data: {
        brief: { name: "Principle limit and editable retry" },
        useTaste: true,
        sourceTasteProfileRevision: first.revision,
      },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json(),
      base = `/api/projects/${project.id}`;
    const before = (await (await page.request.get(base)).json()).current;
    const oldExportResponse = await page.request.post(`${base}/exports`, {
      data: { baseRevision: 1 },
    });
    expect(oldExportResponse.ok()).toBe(true);
    const oldExport = await oldExportResponse.json();
    const jsonName = Object.keys(oldExport.files).find((name) =>
      name.endsWith(".json"),
    )!;
    const oldUrl = `${base}/exports/${oldExport.id}/${encodeURIComponent(jsonName)}`;
    const oldBytes = await (await page.request.get(oldUrl)).text();
    const updatedResponse = await page.request.post("/api/profile", {
      data: {
        ...first.snapshot,
        baseProfileRevision: first.revision,
        principles: [
          ...principles.slice(1),
          { ...principles[0], id: `${prefix}-new`, text: "追加する原則" },
        ],
      },
    });
    expect(updatedResponse.ok()).toBe(true);
    const updated = await updatedResponse.json();
    await page.goto(`/projects/${project.id}/overview`);
    await page.getByRole("button", { name: "差分を確認", exact: true }).click();
    const oldChoice = page.getByLabel(`差分 principle:${principles[0].id}`, {
        exact: true,
      }),
      newChoice = page.getByLabel(`差分 principle:${prefix}-new`, {
        exact: true,
      });
    await expect(page.locator(".taste-diff select")).toHaveCount(2);
    await oldChoice.selectOption("keep");
    await newChoice.selectOption("adopt");
    const confirm = page.getByRole("button", {
      name: "選択を確定して新revisionを作成",
      exact: true,
    });
    const failed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${base}/taste-diff` &&
        response.request().method() === "POST",
    );
    await confirm.click();
    expect((await failed).status()).toBe(400);
    const alert = page.locator(".editor-actions").getByRole("alert");
    await expect(alert).toContainText("取り込み後の原則は100件までです");
    await expect(alert).toContainText("取り込み・維持の選択を見直してください");
    await expect(page.locator(".editor-actions")).toContainText("設計 r1");
    await expect(oldChoice).toBeEnabled();
    await expect(oldChoice).toHaveValue("keep");
    await expect(newChoice).toBeEnabled();
    await expect(newChoice).toHaveValue("adopt");
    expect((await (await page.request.get(base)).json()).current).toEqual(
      before,
    );
    expect(
      (await (await page.request.get(`${base}/exports`)).json()).map(
        (record: { id: string }) => record.id,
      ),
    ).toEqual([oldExport.id]);
    expect(
      (await (await page.request.get("/api/profile")).json()).current,
    ).toEqual(updated);
    await oldChoice.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../evidence/taste-limit-ui/rejected-${width}.png`,
    });
    await oldChoice.selectOption("adopt");
    await confirm.click();
    await expect(oldChoice).toHaveCount(0);
    await expect(page.locator(".editor-actions")).toContainText("設計 r2");
    const saved = (await (await page.request.get(base)).json()).current;
    expect(saved.snapshot.taste.principles).toHaveLength(100);
    expect(saved.snapshot.taste.principles).toEqual(
      updated.snapshot.principles,
    );
    expect(saved.snapshot.sourceTasteProfileRevision).toBe(updated.revision);
    expect(saved.design).toEqual(before.design);
    await page.reload();
    await expect(page.locator(".editor-actions")).toContainText("設計 r2");
    await page.goto(`/projects/${project.id}/export`);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "画像なし ZIP を生成", exact: true })
      .click();
    const zip = unzipSync(await readFile((await (await download).path())!));
    const designName = Object.keys(zip).find((name) =>
      name.endsWith("/design-system.json"),
    )!;
    const system = JSON.parse(strFromU8(zip[designName]));
    expect(system.revision).toBe(2);
    expect(system.taste.principles).toEqual(updated.snapshot.principles);
    const repeat = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "画像なし ZIP を生成", exact: true })
      .click();
    await repeat;
    expect(
      await (await page.request.get(`${base}/exports`)).json(),
    ).toHaveLength(2);
    expect(await (await page.request.get(oldUrl)).text()).toBe(oldBytes);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
