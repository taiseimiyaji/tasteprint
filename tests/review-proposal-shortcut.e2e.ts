import { test, expect } from "@playwright/test";

test("390px Review summary reaches the proposal action without requesting AI", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await page.request.post("/api/projects", {
    data: { brief: { name: "Review proposal shortcut" }, useTaste: false },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  let proposalPosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/proposals")
    )
      proposalPosts++;
  });
  const unsent = "https://example.com/unsent-review-shortcut";
  const url = page.getByRole("textbox", { name: "Reference URL", exact: true });
  const navigate = async (step: string) => {
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
    await page
      .getByRole("navigation", { name: "プロジェクトの設計", exact: true })
      .getByRole("link", { name: step, exact: true })
      .click();
  };
  await page.goto(`/projects/${project.id}/inspiration`);
  await url.fill(unsent);
  await navigate("AI Review");
  await expect(page).toHaveURL(`/projects/${project.id}/review`);
  await page.getByRole("button", { name: "3画面を撮影してレビュー" }).click();
  const shortcut = page.getByRole("link", {
    name: "修正案を作成する場所へ移動",
  });
  const action = page.getByRole("button", {
    name: "修正案を作成",
    exact: true,
  });
  await expect(shortcut).toBeVisible({ timeout: 90000 });
  await expect(action).toBeEnabled();
  await shortcut.click();
  await expect(action).toBeInViewport();
  expect(proposalPosts).toBe(0);
  await navigate("Inspiration");
  await expect(url).toHaveValue(unsent);
  expect(
    (
      await (
        await page.request.get(`/api/projects/${project.id}/references`)
      ).json()
    ).references,
  ).toHaveLength(0);
});
