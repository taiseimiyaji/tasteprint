import { expect, test } from "@playwright/test";

test("an Export request remains pending while visiting Review", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Export pending step" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (entered = resolve));
  let posts = 0;
  await page.route(`**${base}/exports`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    entered();
    await held;
    await route.fulfill({ response });
  });

  await page.goto(`/projects/${project.id}/export`);
  await expect(
    page.getByRole("button", { name: "JSON", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await started;
  await expect(
    page.getByRole("button", { name: "JSON", exact: true }),
  ).toBeDisabled();

  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "AI Review", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/review$`));
  await page
    .getByRole("navigation", { name: "プロジェクトの設計" })
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/export$`));
  await expect(
    page.getByRole("button", { name: "JSON", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);

  const download = page.waitForEvent("download");
  release();
  await download;
  await expect(
    page.getByRole("button", { name: "JSON", exact: true }),
  ).toBeEnabled();
  const records = await (await page.request.get(`${base}/exports`)).json();
  expect(records).toHaveLength(1);
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
