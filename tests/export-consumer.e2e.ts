import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { openExportConsumer } from "./export-consumer";

for (const width of [1440, 390]) {
  for (const screen of ["list", "settings", "form"]) {
    test(`downloaded ${screen} page works independently at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openExportConsumer(page, screen);
      if (screen === "list") {
        await expect(page.getByRole("table")).toBeVisible();
        const archived = page.getByRole("tab", { name: "Archived" });
        await archived.focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByText("No projects found. Try another search."),
        ).toBeVisible();
        await page.keyboard.press("ArrowLeft");
        await expect(page.getByRole("table")).toBeVisible();
        await page
          .getByRole("button", { name: "New project", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("New project name").fill("配布アプリの確認");
        await page.keyboard.press("Enter");
        await expect(dialog).toBeHidden();
        await expect(
          page.getByRole("cell", { name: "配布アプリの確認" }),
        ).toBeVisible();
        await page
          .getByRole("textbox", { name: "Search projects" })
          .fill("missing consumer project");
        await expect(page.getByRole("table")).toHaveCount(0);
        await expect(
          page.getByText("No projects found. Try another search."),
        ).toBeVisible();
      } else {
        await page.clock.install();
        const fields = page.locator("input[required]");
        const submit = page.getByRole("button", {
          name: screen === "form" ? "Create project" : "Save changes",
          exact: true,
        });
        if (screen === "form") {
          await submit.click();
          await expect(page.getByRole("alert")).toBeVisible();
          await expect(fields.first()).toBeFocused();
          await fields.first().fill("配布アプリ");
          await fields.nth(1).fill("日本語の説明");
        } else {
          await fields.nth(1).fill("invalid-email");
          await submit.click();
          await expect(page.getByRole("alert")).toBeVisible();
          await expect(fields.nth(1)).toBeFocused();
          await fields.nth(1).fill("consumer@example.com");
        }
        const checkbox = page.getByRole("checkbox", {
          name: "Notify me about project updates",
        });
        await checkbox.focus();
        await page.keyboard.press("Space");
        await expect(checkbox).not.toBeChecked();
        await fields.first().focus();
        await page.keyboard.press("Enter");
        const saving = page.getByRole("button", {
          name: "Saving…",
          exact: true,
        });
        await expect(saving).toBeDisabled();
        await expect(saving).toHaveAttribute("aria-busy", "true");
        await page.clock.runFor(300);
        await expect(
          page.getByRole("button", { name: "Saved in preview", exact: true }),
        ).toBeEnabled();
        await expect(page.getByRole("alert")).toHaveCount(0);
      }
      expect(
        await page
          .locator("html")
          .evaluate((el) => el.scrollWidth <= innerWidth),
      ).toBe(true);
      expect(errors).toEqual([]);
      const directory = "../evidence/export-consumer";
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: `${directory}/${screen}-${width}.png` });
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
  }
  test(`downloaded Dialog specimen opens without submitting at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openExportConsumer(page, "specimen");
    const count = page.getByLabel("Submit count");
    const trigger = page.getByRole("button", {
      name: "Open dialog",
      exact: true,
    });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(await count.textContent()).toBe("0");
  });
  test(`downloaded Tabs and Dialog never submit their consumer form at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { record } = await openExportConsumer(page);
    const count = page.getByLabel("Submit count");
    const seen: Record<string, string | null> = {};
    const capture = async (name: string) => {
      seen[name] = await count.textContent();
    };
    const all = page.getByRole("tab", { name: "All projects" });
    const archived = page.getByRole("tab", { name: "Archived" });
    await archived.click();
    await expect(archived).toHaveAttribute("aria-selected", "true");
    await capture("tabClick");
    await all.focus();
    await page.keyboard.press("Enter");
    await expect(all).toHaveAttribute("aria-selected", "true");
    await capture("tabEnter");
    await archived.focus();
    await page.keyboard.press("Space");
    await capture("tabSpace");
    await page.keyboard.press("Home");
    await expect(all).toBeFocused();
    await page.keyboard.press("End");
    await expect(archived).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(all).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(archived).toBeFocused();
    await capture("tabNavigation");
    await page.getByLabel("Disable tabs").check();
    await expect(all).toBeDisabled();
    await expect(archived).toBeDisabled();
    await page.getByLabel("Disable tabs").uncheck();
    const trigger = page.getByRole("button", { name: "Open confirmation" });
    for (const [action, key] of [
      ["Cancel", "click"],
      ["Cancel", "Enter"],
      ["Confirm", "Space"],
      ["Escape", "Escape"],
    ]) {
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Confirmation note")).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(
        dialog.getByRole("button", { name: "Confirm", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByLabel("Confirmation note")).toBeFocused();
      if (action === "Escape") await page.keyboard.press("Escape");
      else {
        const button = dialog.getByRole("button", {
          name: action,
          exact: true,
        });
        if (key === "click") await button.click();
        else {
          await button.focus();
          await page.keyboard.press(key);
        }
      }
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await capture(`dialog${action}${key}`);
    }
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "日本語プロジェクト",
    );
    await expect(page.getByLabel("Notify me")).toBeChecked();
    await page
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption("Done");
    expect(
      await page.locator("html").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
    const directory = "../evidence/export-consumer";
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/consumer-${width}.png` });
    writeFileSync(
      `${directory}/consumer-${width}.json`,
      JSON.stringify(
        { width, templateVersion: record.templateVersion, seen, errors },
        null,
        2,
      ),
    );
    expect(Object.values(seen)).toEqual(Object.values(seen).map(() => "0"));
    await page.getByRole("button", { name: "Save form", exact: true }).click();
    await expect(count).toHaveText("1");
  });
}
