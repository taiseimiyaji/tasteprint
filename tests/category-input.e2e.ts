import { test, expect, type Page } from "@playwright/test";
const save = (page: Page) =>
  page.getByRole("button", { name: "変更を保存", exact: true });
async function open(page: Page, editor: string) {
  const p = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name: `Category retention ${editor}` },
        useTaste: false,
      },
    })
  ).json();
  await page.goto(`/projects/${p.id}/${editor}`);
  await expect(save(page)).toBeVisible();
  return p;
}
async function current(page: Page, id: string) {
  return (
    await (await page.request.get(`/api/projects/${id}/foundation`)).json()
  ).current;
}
async function capture(page: Page, name: string, width: number) {
  await page
    .locator(".foundation-fields [role=alert]")
    .first()
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/category-${name}-${width}.png` });
}
for (const width of [1440, 390]) {
  test(`Foundation retains errors across categories and offers recovery at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const p = await open(page, "foundation");
    const accent = page.getByLabel("accent", { exact: true });
    await accent.fill("unfinished-accent");
    await page.getByRole("tab", { name: "Typography", exact: true }).click();
    await expect(save(page)).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Colorsのアクセント色を修正",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("fontSize", { exact: true }).fill("0");
    await page.getByRole("tab", { name: "Spacing", exact: true }).click();
    await page.getByLabel("pagePadding", { exact: true }).fill("24");
    await expect(save(page)).toBeDisabled();
    await capture(page, "foundation", width);
    await page
      .getByRole("button", { name: "Colorsのアクセント色を修正", exact: true })
      .click();
    await expect(accent).toHaveValue("unfinished-accent");
    await expect(accent).toHaveAttribute("aria-invalid", "true");
    await accent.fill("#334455");
    await expect(save(page)).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Typographyの本文の文字サイズ (px)を修正",
        exact: true,
      })
      .click();
    const size = page.getByLabel("fontSize", { exact: true });
    await expect(size).toHaveValue("0");
    await expect(size).toHaveAttribute("aria-invalid", "true");
    await size.fill("17");
    await expect(page.locator(".foundation-fields [role=alert]")).toHaveCount(
      0,
    );
    await expect(save(page)).toBeEnabled();
    expect((await current(page, p.id)).revision).toBe(1);
    await save(page).click();
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r2",
    );
    expect((await current(page, p.id)).design).toMatchObject({
      accent: "#334455",
      fontSize: 17,
      pagePadding: 24,
    });
  });
  test(`Patterns retains independent gap errors including blank values at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const p = await open(page, "patterns");
    const gap = page.getByLabel("余白 (px)", { exact: true });
    await gap.fill("-1");
    await page.getByRole("button", { name: "FilterBar", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "ListPageの余白を修正", exact: true }),
    ).toBeVisible();
    await gap.fill("");
    await page
      .getByLabel("用途", { exact: true })
      .fill("保持した入力を直してから保存");
    await expect(save(page)).toBeDisabled();
    await capture(page, "patterns", width);
    await page
      .getByRole("button", { name: "ListPageの余白を修正", exact: true })
      .click();
    await expect(gap).toHaveValue("-1");
    await gap.fill("24");
    await expect(save(page)).toBeDisabled();
    await page
      .getByRole("button", { name: "FilterBarの余白を修正", exact: true })
      .click();
    await expect(gap).toHaveValue("");
    await expect(gap).toHaveAttribute("aria-invalid", "true");
    await gap.fill("28");
    await expect(page.locator(".foundation-fields [role=alert]")).toHaveCount(
      0,
    );
    await expect(save(page)).toBeEnabled();
    expect((await current(page, p.id)).revision).toBe(1);
    await save(page).click();
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r2",
    );
    const d = (await current(page, p.id)).design;
    expect(d.patterns.ListPage.gap).toBe(24);
    expect(d.patterns.FilterBar).toMatchObject({
      gap: 28,
      usage: "保持した入力を直してから保存",
    });
  });
}
test("Shared borderColor uses one error across Colors and Borders", async ({
  page,
}) => {
  const p = await open(page, "foundation");
  const field = page.getByLabel("borderColor", { exact: true });
  await field.fill("unfinished-border");
  await page.getByRole("tab", { name: "Borders", exact: true }).click();
  await expect(field).toHaveValue("unfinished-border");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".foundation-fields [role=alert]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Colorsの.*を修正/ }),
  ).toHaveCount(0);
  await field.fill("#112233");
  await page.getByRole("tab", { name: "Colors", exact: true }).click();
  await expect(field).toHaveValue("#112233");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator(".foundation-fields [role=alert]")).toHaveCount(0);
  await save(page).click();
  await expect(page.locator(".editor-actions")).toContainText(
    "保存済み · 設計 r2",
  );
  expect((await current(page, p.id)).design.borderColor).toBe("#112233");
});
for (const editor of ["foundation", "patterns"])
  test(`${editor} explicit cancel clears hidden and visible category errors`, async ({
    page,
  }) => {
    const p = await open(page, editor);
    const field =
      editor === "foundation"
        ? page.getByLabel("accent", { exact: true })
        : page.getByLabel("余白 (px)", { exact: true });
    const original = await field.inputValue();
    await field.fill(editor === "foundation" ? "unfinished-accent" : "-1");
    if (editor === "foundation") {
      await page.getByRole("tab", { name: "Typography", exact: true }).click();
      await page.getByLabel("fontSize", { exact: true }).fill("0");
    } else {
      await page
        .getByRole("button", { name: "FilterBar", exact: true })
        .click();
      await field.fill("");
    }
    await page
      .getByRole("button", { name: "未保存の変更を取り消す", exact: true })
      .click();
    await expect(page.locator(".foundation-fields [role=alert]")).toHaveCount(
      0,
    );
    if (editor === "foundation")
      await page.getByRole("tab", { name: "Colors", exact: true }).click();
    else
      await page.getByRole("button", { name: "ListPage", exact: true }).click();
    await expect(field).toHaveValue(original);
    await expect(field).toHaveAttribute("aria-invalid", "false");
    await expect(save(page)).toBeDisabled();
    expect((await current(page, p.id)).revision).toBe(1);
  });
test("Hidden pattern recovery selects the same Preview screen as the normal card", async ({
  page,
}) => {
  await open(page, "patterns");
  const gap = page.getByLabel("余白 (px)", { exact: true });
  await gap.fill("-1");
  await page
    .getByRole("button", { name: "SettingsSection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ListPageの余白を修正", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "ListPage 設定", exact: true }),
  ).toBeVisible();
  await gap.fill("24");
  await page
    .locator(".app-sidebar")
    .getByRole("link", { name: "Preview", exact: true })
    .click();
  await expect(
    page
      .locator(".preview-toolbar")
      .getByRole("button", { name: "List", exact: true }),
  ).toHaveClass("selected");
  await expect(
    page
      .locator(".preview-toolbar")
      .getByRole("button", { name: "Settings", exact: true }),
  ).not.toHaveClass("selected");
});
