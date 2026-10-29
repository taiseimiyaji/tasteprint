import { test, expect } from "@playwright/test";
import { openExportConsumer } from "./export-consumer";

for (const width of [1440, 390]) {
  test(`downloaded list Confirm validates and creates at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { record } = await openExportConsumer(page, "list");
    expect(record.templateVersion).toBe("preview-16");
    const opener = page.getByRole("button", {
      name: "New project",
      exact: true,
    });
    await opener.click();
    const dialog = page.getByRole("dialog");
    const name = dialog.getByLabel("New project name");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(name).toBeFocused();
    expect(
      await name.evaluate(
        (input: HTMLInputElement) => input.validity.valueMissing,
      ),
    ).toBe(true);

    await name.fill("   ");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText(
      "名前を入力してください。",
    );
    await expect(name).toBeFocused();

    await name.fill("確認操作のテスト");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Confirm", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("cell", { name: "確認操作のテスト" }),
    ).toBeVisible();
    await expect(opener).toBeFocused();

    await opener.click();
    await name.fill("取消した入力");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("cell", { name: "取消した入力" })).toHaveCount(
      0,
    );
    await expect(opener).toBeFocused();
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
