import { test, expect } from "@playwright/test";
import { openExportConsumer } from "./export-consumer";

for (const screen of ["settings", "form"]) {
  test(`downloaded ${screen} page does not claim an edit made during save is saved`, async ({
    page,
  }) => {
    const { record } = await openExportConsumer(page, screen);
    expect(record.templateVersion).toBe("preview-15");
    await page.clock.install();
    const first = page.locator("input[required]").first();
    const second = page.locator("input[required]").nth(1);
    if (screen === "form") {
      await first.fill("Before submit");
      await second.fill("Description before submit");
    }
    const submit = page.getByRole("button", {
      name: screen === "form" ? "Create project" : "Save changes",
      exact: true,
    });
    await submit.click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await first.fill("Edited while saving");
    await page.clock.runFor(300);
    await expect(first).toHaveValue("Edited while saving");
    await expect(submit).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Saved in preview", exact: true }),
    ).toHaveCount(0);
    await submit.click();
    await page.clock.runFor(300);
    await expect(
      page.getByRole("button", { name: "Saved in preview", exact: true }),
    ).toBeEnabled();
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
