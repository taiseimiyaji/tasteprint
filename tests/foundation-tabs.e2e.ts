import { test, expect, type Page } from "@playwright/test";
const names = [
  "Colors",
  "Typography",
  "Spacing",
  "Radius",
  "Borders",
  "Shadows",
  "Motion",
  "Breakpoints",
];
async function project(page: Page) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name: "Keyboard Foundation" }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  const p = await response.json();
  await page.goto(`/projects/${p.id}/foundation`);
  await expect(
    page.getByRole("tab", { name: "Colors", exact: true }),
  ).toBeVisible();
  return p;
}
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
async function selected(page: Page, name: string, keyboard = true) {
  await expect(tab(page, name)).toBeFocused();
  if (keyboard) {
    await expect(tab(page, name)).toHaveCSS("outline-width", "2px");
    await expect(tab(page, name)).toHaveCSS("outline-offset", "-2px");
  }
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
  const states = await page
    .getByRole("tablist", { name: "Foundation categories" })
    .getByRole("tab")
    .evaluateAll((items) =>
      items.map((item) => ({
        selected: item.getAttribute("aria-selected"),
        tabIndex: (item as HTMLElement).tabIndex,
      })),
    );
  expect(states.filter((s) => s.selected === "true")).toHaveLength(1);
  expect(states.filter((s) => s.tabIndex === 0)).toHaveLength(1);
  expect(
    states
      .filter((s) => s.selected === "false")
      .every((s) => s.tabIndex === -1),
  ).toBe(true);
  const panel = page.getByRole("tabpanel", { name, exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("id", "foundation-panel");
  await expect(panel).toHaveAttribute(
    "aria-labelledby",
    `foundation-tab-${name}`,
  );
  await expect(tab(page, name)).toHaveAttribute(
    "aria-controls",
    "foundation-panel",
  );
}
for (const width of [1440, 390])
  test(`Foundation tab keyboard focus, wrap and entry work at ${width}px without changing design`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const p = await project(page);
    let posts = 0;
    page.on("request", (request) => {
      if (
        request.url().includes(`/api/projects/${p.id}/`) &&
        request.method() !== "GET"
      )
        posts++;
    });
    await tab(page, "Colors").focus();
    await selected(page, "Colors");
    for (const name of names.slice(1)) {
      await page.keyboard.press("ArrowRight");
      await selected(page, name);
    }
    await page.keyboard.press("ArrowRight");
    await selected(page, "Colors");
    await page.keyboard.press("ArrowLeft");
    await selected(page, "Breakpoints");
    await page.keyboard.press("Home");
    await selected(page, "Colors");
    await page.keyboard.press("End");
    await selected(page, "Breakpoints");
    await tab(page, "Shadows").click();
    await selected(page, "Shadows", false);
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="tablist"]'),
      ),
    ).toBe(false);
    await page.keyboard.press("Tab");
    await selected(page, "Shadows");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("tabpanel", { name: "Shadows", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("tabpanel", { name: "Shadows", exact: true }),
    ).toHaveCSS("outline-width", "2px");
    await page.keyboard.press("Shift+Tab");
    await selected(page, "Shadows");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await selected(page, "Colors");
    await page.keyboard.press("ArrowUp");
    await selected(page, "Colors");
    await page.keyboard.press("Enter");
    await selected(page, "Colors");
    await page.keyboard.press("Space");
    await selected(page, "Colors");
    await tab(page, "Colors").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/foundation-tabs-${width}.png`,
    });
    const current = (
      await (await page.request.get(`/api/projects/${p.id}/foundation`)).json()
    ).current;
    expect(current.revision).toBe(1);
    expect(posts).toBe(0);
  });

test("keyboard category changes retain valid draft edits and keep inputs protected until the pending save finishes", async ({
  page,
}) => {
  const p = await project(page),
    endpoint = `/api/projects/${p.id}/foundation/save`;
  await page.getByLabel("accent", { exact: true }).fill("#334455");
  await tab(page, "Colors").focus();
  await page.keyboard.press("ArrowRight");
  await selected(page, "Typography");
  await page.keyboard.press("Home");
  await selected(page, "Colors");
  await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
    "#334455",
  );
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let posts = 0;
  await page.route(`**${endpoint}`, async (route) => {
    posts++;
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await started;
  try {
    await tab(page, "Colors").focus();
    await page.keyboard.press("End");
    await selected(page, "Breakpoints");
    await expect(
      page.getByRole("tabpanel").locator("input").first(),
    ).toBeDisabled();
    await page.keyboard.press("Home");
    await selected(page, "Colors");
    await expect(page.getByLabel("accent", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "変更を保存", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator(".editor-actions")).toContainText(
    "保存済み · 設計 r2",
  );
  await expect(page.getByLabel("accent", { exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
    "#334455",
  );
  const current = (
    await (await page.request.get(`/api/projects/${p.id}/foundation`)).json()
  ).current;
  expect(current.revision).toBe(2);
  expect(current.design.accent).toBe("#334455");
  expect(posts).toBe(1);
});
