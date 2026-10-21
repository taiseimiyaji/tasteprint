import { test, expect } from "@playwright/test";

test("archived Export allows saved ZIP retrieval without offering generation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Archived Export probe" }, useTaste: false },
    })
  ).json();
  const created = await page.request.post(
    `/api/projects/${project.id}/exports`,
    {
      data: { baseRevision: 1, bundle: true, imageMode: "omit" },
    },
  );
  expect(created.ok()).toBe(true);
  const record = await created.json();
  const archived = await page.request.post(
    `/api/projects/${project.id}/archive`,
    {
      data: { baseRevision: 1, archived: true },
    },
  );
  expect(archived.ok()).toBe(true);
  await page.goto("/projects");
  await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
  const row = page.locator(".project-list article").filter({
    has: page.getByRole("heading", { name: "Archived Export probe" }),
  });
  await expect(row).toContainText("最新Export r1");
  await row.getByRole("link", { name: "最新Export r1" }).click();
  await expect(page).toHaveURL(/\/export#export-/);
  await expect(
    page.getByText("アーカイブ中 · 変更するには一覧から解除してください"),
  ).toBeVisible();
  const file = page.getByRole("link", { name: /保存済みZIPを再ダウンロード/ });
  await expect(file).toBeVisible();
  const filename = Object.keys(record.files).find((name) =>
    name.endsWith(".zip"),
  );
  expect(filename).toBeTruthy();
  const generate = page.getByRole("button", { name: "画像なし ZIP を生成" });
  await expect(generate).toBeDisabled();
  await expect(page.getByRole("button", { name: "DESIGN.md" })).toBeDisabled();
  await expect(
    page.getByText(
      "アーカイブ中は新しいExportを生成できません。保存済みファイルは下の履歴から取得できます。",
    ),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await file.click();
  expect((await download).suggestedFilename()).toBe(filename);
  expect(
    (
      await page.request.get(
        `/api/projects/${project.id}/exports/${record.id}/${filename}`,
      )
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/archive`, {
        data: { baseRevision: 1, archived: false },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(generate).toBeEnabled();
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
