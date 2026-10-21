import { expect, test, type Page } from "@playwright/test";

async function project(page: Page, name: string) {
  return (
    await page.request.post("/api/projects", {
      data: { brief: { name }, useTaste: false },
    })
  ).json();
}

test("an unsent Reference URL survives project steps without being persisted or sent", async ({
  page,
}) => {
  const p = await project(page, "Unsent Reference URL");
  const path = `/projects/${p.id}/inspiration`;
  const unsent = "https://example.com/unsent-reference?token=fixture-only";
  const url = page.getByRole("textbox", { name: "Reference URL", exact: true });
  await page.goto(path);
  await url.fill(unsent);
  await page
    .locator("nav")
    .getByRole("link", { name: "概要・設計方針", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(url).toHaveValue(unsent);
  await page
    .locator("nav")
    .getByRole("link", { name: "Foundation", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/foundation$`));
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}/foundation$`));
  await expect(page.getByText("移動を中止しました")).toBeVisible();
  await page
    .locator("nav")
    .getByRole("link", { name: "Inspiration", exact: true })
    .click();
  await expect(url).toHaveValue(unsent);
  expect(
    (await (await page.request.get(`/api/projects/${p.id}/references`)).json())
      .references,
  ).toHaveLength(0);
  expect(
    await page.evaluate(
      (token) =>
        [localStorage, sessionStorage].some((storage) =>
          Object.keys(storage).some(
            (key) =>
              key.includes(token) || storage.getItem(key)?.includes(token),
          ),
        ),
      "fixture-only",
    ),
  ).toBe(false);
  await url.fill("");
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(path);
  await expect(url).toHaveValue("");
  await url.fill("https://example.com/accepted-reference");
  await page.getByRole("button", { name: "参考を追加", exact: true }).click();
  await expect(url).toHaveValue("");
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/projects/${p.id}/references`)
          ).json()
        ).references.length,
    )
    .toBe(1);
  await page.reload();
  await expect(url).toHaveValue("");
});

test("a pending or uncertain Reference create blocks navigation and ordinary resend", async ({
  page,
}) => {
  const p = await project(page, "Reference uncertain create");
  const base = `/api/projects/${p.id}/references`;
  const path = `/projects/${p.id}/inspiration`;
  await page.goto(path);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let posts = 0;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => (started = resolve));
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    started();
    await held;
    await route.fulfill({
      status: 503,
      json: { message: "fixture uncertain create" },
    });
  });
  const url = page.getByRole("textbox", { name: "Reference URL", exact: true });
  await url.fill("https://example.com/uncertain-reference");
  await page.getByRole("button", { name: "参考を追加", exact: true }).click();
  await entered;
  try {
    await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page
      .locator("nav")
      .getByRole("link", { name: "Foundation", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  } finally {
    release();
  }
  await expect(
    page.getByRole("alert").filter({ hasText: "追加結果を確認できません" }),
  ).toBeVisible();
  await page
    .locator("nav")
    .getByRole("link", { name: "Foundation", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(url).toHaveValue("https://example.com/uncertain-reference");
  await expect(
    page.getByRole("button", { name: "参考を追加", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await page.reload();
  await expect(url).toHaveValue("");
  expect(posts).toBe(1);
  expect((await (await page.request.get(base)).json()).references).toHaveLength(
    1,
  );
});

test("Profile does not carry an unsent Reference URL after explicitly leaving", async ({
  page,
}) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "参考を集める", exact: true }).click();
  const url = page.getByRole("textbox", { name: "Reference URL", exact: true });
  await url.fill("https://example.com/profile-reference");
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(url).toHaveValue("https://example.com/profile-reference");
  await url.fill("");
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto("/profile");
  await page.getByRole("button", { name: "参考を集める", exact: true }).click();
  await expect(url).toHaveValue("");
});
