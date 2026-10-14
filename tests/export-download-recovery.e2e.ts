import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a failed file GET shows an error and history retries the saved ZIP without another export", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Export delivery recovery" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  const probe = `/api/e2e-fail-export-download/${project.id}`;
  let posts = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === `${base}/exports` &&
      request.method() === "POST"
    )
      posts++;
  });
  expect((await page.request.post(probe)).ok()).toBe(true);
  await page.goto(`/projects/${project.id}/export`);
  await page
    .getByRole("button", { name: "画像なし ZIP を生成", exact: true })
    .click();
  await expect
    .poll(async () => (await (await page.request.get(probe)).json()).count)
    .toBe(1);
  const error = page.getByRole("alert").filter({
    hasText: "isolated download failure",
  });
  await expect(error).toContainText("ダウンロードに失敗");
  const history = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Export履歴" }) });
  const zip = history.getByRole("link", { name: /\.zip$/ });
  await expect(zip).toBeVisible();
  expect(posts).toBe(1);
  expect(await (await page.request.get(`${base}/exports`)).json()).toHaveLength(
    1,
  );

  expect((await page.request.delete(probe)).ok()).toBe(true);
  const download = page.waitForEvent("download");
  await zip.click();
  const file = await readFile((await (await download).path())!);
  expect(file.subarray(0, 4)).toEqual(Buffer.from([80, 75, 3, 4]));
  await expect(error).toHaveCount(0);
  expect(posts).toBe(1);

  expect((await page.request.post(probe)).ok()).toBe(true);
  await zip.click();
  await expect
    .poll(async () => (await (await page.request.get(probe)).json()).count)
    .toBe(1);
  await expect(error).toContainText("ダウンロードに失敗");
  expect(posts).toBe(1);
  expect(await (await page.request.get(`${base}/exports`)).json()).toHaveLength(
    1,
  );
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
