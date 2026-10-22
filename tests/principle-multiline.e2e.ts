import { expect, test } from "@playwright/test";

test("project principle paragraphs survive save and revisit", async ({
  page,
}) => {
  const response = await page.request.post("/api/projects", {
    data: {
      brief: { name: `Multiline principle ${crypto.randomUUID()}` },
      useTaste: false,
    },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  const text = "原則の背景\n適用する画面\n例外条件";
  const reason = "判断理由 A\n判断理由 B";
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/projects/${project.id}/overview`);
    await page.getByRole("button", { name: "原則を追加", exact: true }).click();
    const principle = page.locator(".principle-fields").first();
    await expect(
      principle.getByLabel("対象（例: list / density / radius）", {
        exact: true,
      }),
    ).toHaveJSProperty("tagName", "INPUT");
    for (const [label, value] of [
      ["原則", text],
      ["理由", reason],
    ]) {
      const field = principle.getByLabel(label, { exact: true });
      await expect(field).toHaveJSProperty("tagName", "TEXTAREA");
      await field.fill(value);
      await expect(principle.getByLabel(label, { exact: true })).toHaveValue(
        value,
      );
    }
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page
      .locator(".editor-actions")
      .getByRole("button", { name: "概要・方針を保存", exact: true })
      .click();
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r2",
    );
    const saved = await page.request.get(`/api/projects/${project.id}`);
    expect(saved.ok()).toBe(true);
    expect((await saved.json()).current.snapshot.policies[0]).toMatchObject({
      text,
      reason,
    });
    await page.reload();
    const revisit = page.locator(".principle-fields").first();
    await expect(revisit.getByLabel("原則", { exact: true })).toHaveValue(text);
    await expect(revisit.getByLabel("理由", { exact: true })).toHaveValue(
      reason,
    );
  } finally {
    const current = await page.request.get(`/api/projects/${project.id}`);
    if (current.ok())
      await page.request.post(`/api/projects/${project.id}/archive`, {
        data: {
          baseRevision: (await current.json()).current.revision,
          archived: true,
        },
      });
  }
});
