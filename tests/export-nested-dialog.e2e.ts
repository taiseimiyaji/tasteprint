import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { openExportConsumer } from "./export-consumer";
for (const width of [1440, 390])
  for (const action of ["Escape", "Cancel", "Confirm"])
    test(`nested consumer ${action} at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openExportConsumer(page, "nested");
      const trigger = page.getByRole("button", {
        name: "Open outer",
        exact: true,
      });
      await trigger.click();
      const outer = page.locator("dialog").first(),
        inner = page.locator("dialog").nth(1);
      const openInner = outer.getByRole("button", {
        name: "Open inner",
        exact: true,
      });
      await openInner.click();
      await expect(inner).toBeVisible();
      await expect(
        inner.getByRole("button", { name: "Disabled inner action" }),
      ).toBeDisabled();
      await inner.getByLabel("Inner draft").focus();
      await inner.getByLabel("Inner draft").fill("inner edited draft");
      await page.keyboard.press("Shift+Tab");
      await expect(
        inner.getByRole("button", { name: "Confirm", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(inner.getByLabel("Inner draft")).toBeFocused();
      if (action === "Escape") await page.keyboard.press("Escape");
      else {
        await inner.getByRole("button", { name: action, exact: true }).focus();
        await page.keyboard.press(action === "Cancel" ? "Enter" : "Space");
      }
      await expect(inner).toBeHidden();
      const result = {
        width,
        action,
        outerOpen: await outer.evaluate((el) => (el as HTMLDialogElement).open),
        focus: await page.evaluate(() => document.activeElement?.textContent),
        submits: await page.getByLabel("Submit count").textContent(),
      };
      mkdirSync("../evidence/export-followup", { recursive: true });
      writeFileSync(
        `../evidence/export-followup/nested-${width}-${action}.json`,
        JSON.stringify(result, null, 2),
      );
      await page.screenshot({
        path: `../evidence/export-followup/nested-${width}-${action}.png`,
      });
      await expect(outer).toBeVisible();
      await expect(openInner).toBeFocused();
      await expect(outer.getByLabel("Outer draft")).toHaveValue("outer draft");
      await expect(inner.getByLabel("Inner draft")).toHaveValue(
        "inner edited draft",
      );
      await expect(page.getByLabel("Submit count")).toHaveText("0");
      await page.keyboard.press("Tab");
      await expect(
        outer.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(openInner).toBeFocused();
      await outer.getByLabel("Outer draft").focus();
      await page.keyboard.press("Shift+Tab");
      await expect(
        outer.getByRole("button", { name: "Confirm", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(outer.getByLabel("Outer draft")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
