import { expect, test } from "@playwright/test";

test("long project purpose stays searchable without burying mobile resume actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tail = "検索対象の末尾";
  const purpose = "用途の詳細と利用条件。".repeat(190).slice(0, 2000 - tail.length) + tail;
  expect(purpose.length).toBe(2000);
  const now = new Date();
  const projects = [
    {
      id: "long-purpose-preview",
      brief: { name: "長文の用途", purpose, audience: "", desired: "", avoid: "" },
      activeRevision: 1,
      archiveVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      archivedAt: null,
      latestExport: null,
    },
    {
      id: "short-purpose-preview",
      brief: { name: "短い用途", purpose: "短い説明", audience: "", desired: "", avoid: "" },
      activeRevision: 1,
      archiveVersion: 1,
      createdAt: now.toISOString(),
      updatedAt: new Date(now.getTime() - 1000).toISOString(),
      archivedAt: null,
      latestExport: null,
    },
  ];
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: projects }),
  );
  await page.goto("/projects");
  const rows = page.locator(".project-list article");
  await expect(rows).toHaveCount(2);
  const long = rows.first();
  await expect(long.locator(".project-purpose-preview")).toHaveText(purpose);
  const layout = await long.evaluate((row) => {
    const rect = row.getBoundingClientRect();
    const purpose = row.querySelector(".project-purpose-preview")!;
    const resume = row.querySelector(".project-row-actions a")!;
    return {
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      rowHeight: rect.height,
      purposeHeight: purpose.getBoundingClientRect().height,
      resumeOffset: resume.getBoundingClientRect().top - rect.top,
    };
  });
  expect(layout.page).toBeLessThanOrEqual(layout.viewport);
  expect(layout.purposeHeight).toBeLessThanOrEqual(60);
  expect(layout.rowHeight).toBeLessThan(450);
  expect(layout.resumeOffset).toBeLessThan(400);
  await expect(rows.nth(1).locator(".project-purpose-preview")).toHaveText("短い説明");
  await page.getByLabel("プロジェクトを検索", { exact: true }).fill(tail);
  await expect(rows).toHaveCount(1);
  await expect(long.getByRole("link", { name: "再開", exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/health")).json()).codexCalls).toBe(0);
});
