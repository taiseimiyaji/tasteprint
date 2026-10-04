import { test, expect } from "@playwright/test";

for (const width of [1440, 390])
  test(`Patterns reorders preserve Archived selection and match the displayed rows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const created = await page.request.post("/api/projects", {
      data: { brief: { name: "Stable pattern identity" }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const warnings: string[] = [],
      errors: string[] = [];
    page.on("console", (message) => {
      if (/same key|unique.*key/i.test(message.text()))
        warnings.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/projects/${project.id}/patterns`);
    const frame = page.frameLocator("iframe");
    const archived = frame.getByRole("tab", { name: "Archived", exact: true });
    const active = frame.getByRole("tab", {
      name: "All projects",
      exact: true,
    });
    const filter = frame.locator('[data-pattern="FilterBar"]');
    await archived.click();
    await expect(archived).toHaveAttribute("aria-selected", "true");
    await filter.evaluate(
      (el) => ((el as HTMLElement).dataset.identity = "preserved"),
    );
    for (const [button, first] of [
      ["FilterBarを上へ", "FilterBar"],
      ["PageHeaderを上へ", "PageHeader"],
      ["FilterBarを上へ", "FilterBar"],
    ]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(
        frame.locator('[data-pattern="ListPage"] > [data-slot]').first(),
      ).toHaveAttribute("data-slot", first);
      await expect(archived).toHaveAttribute("aria-selected", "true");
      await expect(active).toHaveAttribute("aria-selected", "false");
      await expect(
        frame.getByText("No projects found. Try another search.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(frame.getByRole("table")).toHaveCount(0);
      await expect(filter).toHaveAttribute("data-identity", "preserved");
      await expect(frame.locator('[data-slot="PageHeader"]')).toHaveCount(1);
      await expect(filter).toHaveCount(1);
    }
    await archived.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(active).toBeFocused();
    await expect(active).toHaveAttribute("aria-selected", "true");
    await expect(frame.getByRole("table")).toBeVisible();
    await expect(filter).toHaveAttribute("data-identity", "preserved");
    await expect(
      frame.getByText("No projects found. Try another search.", {
        exact: true,
      }),
    ).toHaveCount(0);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      (
        await (
          await page.request.get(`/api/projects/${project.id}/foundation`)
        ).json()
      ).current.revision,
    ).toBe(1);
  });
