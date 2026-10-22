import { expect, test } from "@playwright/test";

test("project list actions identify their project to assistive technology", async ({
  page,
}) => {
  const names = ["Action target alpha", "Action target beta"];
  const projects: { id: string }[] = [];
  try {
    for (const name of names) {
      const response = await page.request.post("/api/projects", {
        data: { brief: { name }, useTaste: false },
      });
      expect(response.ok()).toBe(true);
      projects.push(await response.json());
    }

    await page.goto("/projects");
    const list = page.getByLabel("進行中の一覧");
    for (const name of names) {
      const row = list
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      await expect(
        row.getByRole("link", { name: `${name}を再開`, exact: true }),
      ).toBeVisible();
      await expect(
        row.getByRole("button", { name: `${name}をアーカイブ`, exact: true }),
      ).toBeVisible();
    }
    await list
      .getByRole("button", { name: `${names[0]}をアーカイブ`, exact: true })
      .click();
    await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
    const archivedRow = page
      .getByLabel("アーカイブ一覧")
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: names[0], exact: true }),
      });
    await expect(
      archivedRow.getByRole("link", { name: `${names[0]}を再開`, exact: true }),
    ).toBeVisible();
    await expect(
      archivedRow.getByRole("button", {
        name: `${names[0]}をアーカイブ解除`,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    for (const project of projects) {
      const current = await page.request.get(`/api/projects/${project.id}`);
      if (current.ok())
        await page.request.post(`/api/projects/${project.id}/archive`, {
          data: {
            baseRevision: (await current.json()).current.revision,
            archived: true,
          },
        });
    }
  }
});
