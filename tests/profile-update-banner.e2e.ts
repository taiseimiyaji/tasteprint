import { test, expect } from "@playwright/test";

for (const useTaste of [false, true]) {
  test(`a resumed project with useTaste=${useTaste} does not claim an unchanged profile was updated`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const profile = (await (await page.request.get("/api/profile")).json())
      .current;
    const created = await page.request.post("/api/projects", {
      data: {
        brief: { name: `Profile update notice ${useTaste}` },
        useTaste,
        ...(useTaste ? { sourceTasteProfileRevision: profile.revision } : {}),
      },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const current = (
      await (await page.request.get(`/api/projects/${project.id}`)).json()
    ).current;
    expect(current.snapshot.sourceTasteProfileRevision).toBe(
      useTaste ? profile.revision : null,
    );
    await page.goto(`/projects/${project.id}/overview`);
    await expect(
      page.getByRole("heading", { name: project.brief.name }),
    ).toBeVisible();
    await expect(
      page.getByText("共通の好みに更新があります · 差分を確認"),
    ).toHaveCount(0);
  });
}
