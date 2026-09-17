import { test, expect } from "@playwright/test";
import { reviewCapture } from "../src/server/review/capture";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { defaultDesign } from "../src/domain/design";

test("library edits persist, restore and stay isolated from the editor theme", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Library" }, useTaste: false },
    })
  ).json();
  await page.goto(`/projects/${project.id}/components`);
  const hostColor = await page
    .locator("h1")
    .evaluate((el) => getComputedStyle(el).color);
  await page.getByLabel("variant", { exact: true }).selectOption("subtle");
  await page.getByLabel("size", { exact: true }).selectOption("lg");
  await page
    .getByLabel("利用ルール", { exact: true })
    .fill("Always label actions");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByText(/確定履歴（revision 2/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("size", { exact: true })).toHaveValue("lg");
  await expect(
    page.frameLocator("iframe").getByRole("button", { name: "Save changes" }),
  ).toHaveCSS("min-height", "44px");
  expect(
    await page.locator("h1").evaluate((el) => getComputedStyle(el).color),
  ).toBe(hostColor);
  await page.goto(`/projects/${project.id}/patterns`);
  await page.getByLabel("余白 (px)").fill("32");
  await page.getByRole("button", { name: "FilterBarを上へ" }).click();
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByText(/確定履歴（revision 3/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("余白 (px)")).toHaveValue("32");
  await expect(
    page.frameLocator("iframe").locator('[data-pattern="ListPage"]'),
  ).toHaveCSS("gap", "32px");
  await expect(
    page
      .frameLocator("iframe")
      .locator('[data-pattern="ListPage"] > [data-slot]')
      .first(),
  ).toHaveAttribute("data-slot", "FilterBar");
  await page.getByText(/確定履歴（revision 3/).click();
  await page.getByRole("button", { name: "r1を復元", exact: true }).click();
  await expect(page.getByLabel("余白 (px)")).toHaveValue("16");
});

test("Dialog traps focus and restores it; Tabs support arrows and all applicable states render", async ({
  page,
}) => {
  await page.goto("/preview-render");
  await page
    .locator("html[data-renderer-ready=true]")
    .waitFor({ state: "attached" });
  const render = async (screen: string) =>
    page.evaluate(
      ({ design, screen }) =>
        window.postMessage(
          { type: "tasteprint-preview", design, screen },
          location.origin,
        ),
      { design: defaultDesign, screen },
    );
  await render("component:Dialog");
  const trigger = page.getByRole("button", { name: "Open dialog" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(trigger).toBeFocused();
  await render("component:Tabs");
  await page.getByRole("tab", { name: "All projects" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Archived" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Archived" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const [name, c] of Object.entries(defaultDesign.components)) {
    await render(`component:${name}`);
    for (const state of c.states) {
      await page.getByLabel("表示状態").selectOption(state);
      await expect(page.locator(".specimen-control")).toHaveAttribute(
        "data-state",
        state,
      );
    }
  }
});

test("all three screens use exact 390 / 768 / 1440 viewports with horizontal table scrolling", async ({
  page,
}) => {
  test.setTimeout(90000);
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Viewports" }, useTaste: false },
    })
  ).json();
  await page.goto(`/projects/${project.id}/preview`);
  for (const screen of ["List", "Settings", "Form"]) {
    await page.getByRole("button", { name: screen, exact: true }).click();
    for (const [label, width] of [
      ["Mobile", 390],
      ["Tablet", 768],
      ["Desktop", 1440],
    ] as const) {
      await page
        .getByRole("button", { name: `${label} ${width}px`, exact: true })
        .click();
      await expect(page.locator("iframe")).toHaveCSS("width", `${width}px`);
      const frame = page.frameLocator("iframe");
      await expect(frame.locator(".sample-app")).toBeVisible();
      expect(
        await frame
          .locator("html")
          .evaluate((el) => el.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (width === 390 && screen === "List")
        expect(
          await frame
            .locator(".sample-table-wrap")
            .evaluate((el) => el.scrollWidth > el.clientWidth),
        ).toBe(true);
      const capture = await reviewCapture("http://127.0.0.1:3100", width)(
        defaultDesign,
        screen.toLowerCase(),
        AbortSignal.timeout(20000),
      );
      expect((await sharp(capture.image).metadata()).width).toBe(width);
      expect(capture.scope[0]).toContain(`${width}×1000`);
      await writeFile(
        `test-results/library-${screen}-${width}.png`,
        capture.image,
      );
    }
  }
});

test("library proposal shows leaf diffs, stages settings and adopts only on confirmation", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Library proposals" }, useTaste: false },
    })
  ).json();
  await page.goto(`/projects/${project.id}/components`);
  await page.getByLabel("デザインへのリクエスト").fill("部品を調整");
  await page.getByRole("button", { name: "提案を依頼", exact: true }).click();
  await expect(
    page
      .locator(".proposal-diff")
      .getByText("components.Button.size", { exact: false }),
  ).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByRole("button", { name: "Save changes" }),
  ).toHaveCSS("min-height", "44px");
  expect(
    (
      await (
        await page.request.get(`/api/projects/${project.id}/foundation`)
      ).json()
    ).current.revision,
  ).toBe(1);
  await page.getByRole("button", { name: "採用する", exact: true }).click();
  await expect(page.getByText(/確定履歴（revision 2/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("size", { exact: true })).toHaveValue("lg");
});
