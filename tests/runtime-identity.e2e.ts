import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

for (const width of [1440, 390]) {
  test(`reused Tabs and Dialog keep local ARIA ownership through hydration at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    // Playwright serializes imported JSX for component tests; render real React
    // in a normal Node loader, using the same fixture that Vite hydrates below.
    const markup = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {createElement} from 'react'; import {renderToString} from 'react-dom/server'; import {RuntimeIdentityFixture} from './tests/runtime-identity-fixture.tsx'; process.stdout.write(renderToString(createElement(RuntimeIdentityFixture)));",
      ],
      { encoding: "utf8" },
    );
    const serverIds = [...markup.matchAll(/\sid="([^"]+)"/g)].map(
      (match) => match[1],
    );
    await page.goto("/preview-render");
    await page.setContent(
      `<!doctype html><html lang="en"><head><title>Reused widgets</title></head><body><div id="identity-root">${markup}</div><script type="module" src="/tests/runtime-identity-client.tsx"></script></body></html>`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-identity-ready",
      "true",
    );
    const ids = () =>
      page
        .locator("#identity-root [id]")
        .evaluateAll((elements) => elements.map((element) => element.id));
    expect(await ids()).toEqual(serverIds);
    expect(new Set(serverIds).size).toBe(serverIds.length);

    for (const instance of ["first", "second"]) {
      const owner = page.locator(`[data-instance="${instance}-tabs"]`);
      const relations = await owner.evaluate((element) => {
        const panel = element.querySelector('[role="tabpanel"]')!;
        const tabs = [...element.querySelectorAll('[role="tab"]')];
        return {
          tabsControlOwnPanel: tabs.every(
            (tab) =>
              document.getElementById(tab.getAttribute("aria-controls")!) ===
              panel,
          ),
          panelLabelIsOwnActiveTab:
            document.getElementById(panel.getAttribute("aria-labelledby")!) ===
            element.querySelector('[role="tab"][aria-selected="true"]'),
        };
      });
      expect(relations).toEqual({
        tabsControlOwnPanel: true,
        panelLabelIsOwnActiveTab: true,
      });
    }
    const first = page.locator('[data-instance="first-tabs"]');
    const second = page.locator('[data-instance="second-tabs"]');
    await second.getByRole("tab", { name: "All projects" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(second.getByRole("tab", { name: "Archived" })).toBeFocused();
    await expect(second.getByRole("tab", { name: "Archived" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(second.getByRole("tabpanel")).toHaveText("Archived");
    await expect(first.getByRole("tabpanel")).toHaveText("All projects");
    expect(
      await second
        .getByRole("tabpanel")
        .evaluate(
          (panel) =>
            document.getElementById(panel.getAttribute("aria-labelledby")!) ===
            panel.parentElement!.querySelector(
              '[role="tab"][aria-selected="true"]',
            ),
        ),
    ).toBe(true);
    expect(await ids()).toEqual(serverIds);

    for (const instance of ["first", "second"]) {
      const owner = page.locator(`[data-instance="${instance}-dialog"]`);
      await owner
        .getByRole("button", { name: `Open ${instance} dialog` })
        .click();
      const dialog = owner.getByRole("dialog", { name: "Confirm changes" });
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate(
          (element) =>
            document.getElementById(
              element.getAttribute("aria-labelledby")!,
            ) === element.querySelector("h2"),
        ),
      ).toBe(true);
      await expect(
        dialog.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      if (instance === "first")
        await dialog.getByRole("button", { name: "Cancel" }).click();
      else await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    expect(await ids()).toEqual(serverIds);
    expect(errors).toEqual([]);
    const health = await (await page.request.get("/api/health")).json();
    expect(health.codexCalls).toBe(0);
    const directory = "../evidence/runtime-identity-ui";
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/reused-${width}.png` });
    writeFileSync(
      `${directory}/verified-${width}.json`,
      JSON.stringify(
        {
          width,
          uniqueIds: true,
          hydrationIdsPreserved: true,
          ownTabPanelAndTitleReferences: true,
          independentTabSelection: true,
          nativeDialogOpenAndClose: true,
          realCodexCalls: health.codexCalls,
        },
        null,
        2,
      ) + "\n",
    );
  });
}
