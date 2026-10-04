import { test, expect, type Page } from "@playwright/test";
async function projectFor(page: Page, editor: string) {
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: `Input validation ${editor}` }, useTaste: false },
    })
  ).json();
  await page.goto(`/projects/${p.id}/${editor}`);
  await expect(
    page.getByRole("button", { name: "変更を保存", exact: true }),
  ).toBeVisible();
  return p;
}
const saveButton = (page: Page) =>
  page.getByRole("button", { name: "変更を保存", exact: true });
const cancelButton = (page: Page) =>
  page.getByRole("button", { name: "未保存の変更を取り消す", exact: true });
async function saved(page: Page, id: string) {
  return (
    await (await page.request.get(`/api/projects/${id}/foundation`)).json()
  ).current;
}
async function save(page: Page, revision: number) {
  await saveButton(page).click();
  await expect(page.locator(".editor-actions")).toContainText(
    `保存済み · 設計 r${revision}`,
  );
}
test("Foundation retains each invalid field through other values and decisions until every error is corrected", async ({
  page,
}) => {
  const p = await projectFor(page, "foundation");
  const accent = page.getByLabel("accent", { exact: true }),
    canvas = page.getByLabel("canvas", { exact: true });
  const original = await saved(page, p.id);
  await accent.fill("unfinished-accent");
  await canvas.fill("unfinished-canvas");
  for (const input of [accent, canvas])
    await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".foundation-fields [role=alert]")).toHaveCount(2);
  await page.getByLabel("ink", { exact: true }).fill("#112233");
  await page.getByLabel("accentをAI変更からロック", { exact: true }).check();
  const field = page.locator(".foundation-field").filter({ has: accent });
  await field
    .getByText("適用範囲・例外・決定理由・出典", { exact: true })
    .click();
  await page
    .getByLabel("accent rationale", { exact: true })
    .fill("入力を直すまで保存しない");
  await expect(accent).toHaveValue("unfinished-accent");
  await expect(canvas).toHaveValue("unfinished-canvas");
  await expect(saveButton(page)).toBeDisabled();
  expect((await saved(page, p.id)).revision).toBe(1);
  await expect(page.frameLocator("iframe").locator(".sample-app")).toHaveCSS(
    "--preview-accent",
    original.design.accent,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await accent.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/foundation-invalid-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await accent.fill("#334455");
  await expect(accent).toHaveAttribute("aria-invalid", "false");
  await expect(canvas).toHaveAttribute("aria-invalid", "true");
  await expect(canvas).toHaveValue("unfinished-canvas");
  await expect(saveButton(page)).toBeDisabled();
  await canvas.fill("#f1f2f3");
  await expect(page.locator(".foundation-fields [role=alert]")).toHaveCount(0);
  await save(page, 2);
  expect((await saved(page, p.id)).design).toMatchObject({
    accent: "#334455",
    canvas: "#f1f2f3",
    ink: "#112233",
    constraints: {
      accent: { locked: true, rationale: "入力を直すまで保存しない" },
    },
  });
  await page.reload();
  await expect(accent).toHaveValue("#334455");
  await expect(canvas).toHaveValue("#f1f2f3");
});
test("Pattern invalid gap survives responsive, structure and usage edits until the gap is corrected", async ({
  page,
}) => {
  const p = await projectFor(page, "patterns");
  const gap = page.getByLabel("余白 (px)", { exact: true });
  const responsive = page.getByLabel("レスポンシブ動作", { exact: true });
  const initialResponsive = await responsive.inputValue();
  const targetResponsive = initialResponsive === "wrap" ? "stack" : "wrap";
  await gap.fill("-1");
  await responsive.selectOption(targetResponsive);
  await page
    .getByRole("button", { name: "FilterBarを上へ", exact: true })
    .click();
  await page.getByLabel("用途", { exact: true }).fill("入力を保持するパターン");
  await expect(gap).toHaveValue("-1");
  await expect(gap).toHaveAttribute("aria-invalid", "true");
  await expect(saveButton(page)).toBeDisabled();
  expect((await saved(page, p.id)).revision).toBe(1);
  await gap.fill("28");
  await expect(gap).toHaveValue("28");
  await expect(gap).toHaveAttribute("aria-invalid", "false");
  await save(page, 2);
  const result = (await saved(page, p.id)).design.patterns.ListPage;
  expect(result).toMatchObject({
    gap: 28,
    responsive: targetResponsive,
    usage: "入力を保持するパターン",
  });
  expect(result.structure[0]).toBe("FilterBar");
  await page.reload();
  await expect(gap).toHaveValue("28");
});
for (const editor of ["foundation", "patterns"]) {
  const field = (page: Page) =>
    editor === "foundation"
      ? page.getByLabel("accent", { exact: true })
      : page.getByLabel("余白 (px)", { exact: true });
  const valid = editor === "foundation" ? "#334455" : "28";
  const invalid = editor === "foundation" ? "unfinished-color" : "-1";
  test(`${editor} explicit cancel clears invalid raw input and all ordinary draft edits`, async ({
    page,
  }) => {
    const p = await projectFor(page, editor);
    const input = field(page),
      original = await input.inputValue();
    await input.fill(valid);
    await input.fill(invalid);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await cancelButton(page).click();
    await expect(input).toHaveValue(original);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator(".foundation-inputs [role=alert]")).toHaveCount(
      0,
    );
    await expect(saveButton(page)).toBeDisabled();
    expect((await saved(page, p.id)).revision).toBe(1);
  });
  test(`${editor} explicit undo and historical restore replace invalid raw input with their selected design`, async ({
    page,
  }) => {
    const p = await projectFor(page, editor);
    const input = field(page),
      original = await input.inputValue();
    await input.fill(valid);
    await input.fill(invalid);
    if (editor === "foundation")
      await page.getByLabel("canvas", { exact: true }).fill("#112233");
    else {
      const responsive = page.getByLabel("レスポンシブ動作", { exact: true });
      await responsive.selectOption(
        (await responsive.inputValue()) === "wrap" ? "stack" : "wrap",
      );
    }
    await expect(input).toHaveValue(invalid);
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(input).toHaveValue(valid);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await save(page, 2);
    await input.fill(invalid);
    await page.getByText(/確定履歴（revision 2/).click();
    await page.getByRole("button", { name: "r1を復元", exact: true }).click();
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r3",
    );
    await expect(input).toHaveValue(original);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(saveButton(page)).toBeDisabled();
    expect((await saved(page, p.id)).revision).toBe(3);
  });
  test(`${editor} explicit AI candidate adoption resets invalid raw input to the accepted design`, async ({
    page,
  }) => {
    const p = await projectFor(page, editor);
    const input = field(page),
      original = await input.inputValue();
    await input.fill(invalid);
    await page
      .getByRole("button", { name: "角丸をもう少し弱くしたい", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "採用する", exact: true }),
    ).toBeVisible();
    await expect(input).toHaveValue(invalid);
    await page.getByRole("button", { name: "採用する", exact: true }).click();
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r2",
    );
    await expect(input).toHaveValue(original);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator(".foundation-inputs [role=alert]")).toHaveCount(
      0,
    );
    expect((await saved(page, p.id)).revision).toBe(2);
  });
}
test("Foundation cross-field breakpoint errors remain until their own input is explicitly corrected", async ({
  page,
}) => {
  const p = await projectFor(page, "foundation");
  await page.getByRole("tab", { name: "Breakpoints", exact: true }).click();
  const compact = page.getByLabel("compactBreakpoint", { exact: true });
  const medium = page.getByLabel("mediumBreakpoint", { exact: true });
  await compact.fill("800");
  await expect(compact).toHaveAttribute("aria-invalid", "true");
  await medium.fill("1000");
  await expect(compact).toHaveValue("800");
  await expect(compact).toHaveAttribute("aria-invalid", "true");
  await expect(saveButton(page)).toBeDisabled();
  expect((await saved(page, p.id)).revision).toBe(1);
  await compact.fill("801");
  await expect(compact).toHaveAttribute("aria-invalid", "false");
  await save(page, 2);
  expect((await saved(page, p.id)).design).toMatchObject({
    compactBreakpoint: 801,
    mediumBreakpoint: 1000,
  });
});
