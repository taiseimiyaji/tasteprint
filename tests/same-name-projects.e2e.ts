import { expect, test } from "@playwright/test";

test("same-name projects retain matching choices through list reorder and archive", async ({
  page,
}) => {
  const name = `同名確認-${crypto.randomUUID().slice(0, 8)}`;
  const purposes = ["受付画面", "在庫管理", "請求画面", "", ""];
  const projects: { id: string; createdAt: string; purpose: string }[] = [];
  try {
    for (const purpose of purposes) {
      const response = await page.request.post("/api/projects", {
        data: { brief: { name, purpose }, useTaste: false },
      });
      expect(response.ok()).toBe(true);
      const project = await response.json();
      projects.push({ id: project.id, createdAt: project.createdAt, purpose });
    }
    const ordered = [...projects].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const labels = new Map(
      ordered.map((project, index) => [
        project.id,
        `${name}（同名 ${index + 1}/${ordered.length}）`,
      ]),
    );
    const rowFor = (id: string) =>
      page
        .getByRole("article")
        .filter({ has: page.locator(`a[href="/projects/${id}/overview"]`) });
    const checkRows = async (ids: string[], archived: boolean) => {
      const list = page.getByLabel(
        archived ? "アーカイブ一覧" : "進行中の一覧",
      );
      for (const id of ids) {
        const row = list.getByRole("article").filter({
          has: page.locator(`a[href="/projects/${id}/overview"]`),
        });
        const label = labels.get(id)!;
        await expect(
          row.getByRole("heading", { name: label, exact: true }),
        ).toBeVisible();
        await expect(
          row.getByRole("link", { name: `${label}を再開`, exact: true }),
        ).toBeVisible();
        await expect(
          row.getByRole("button", {
            name: `${label}を${archived ? "アーカイブ解除" : "アーカイブ"}`,
            exact: true,
          }),
        ).toBeVisible();
      }
    };

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projects");
    await checkRows(
      projects.map((project) => project.id),
      false,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/same-name-list-390.png",
      fullPage: true,
    });

    await page.goto(`/projects/${projects[0].id}/overview`);
    await page.getByRole("button", { name: "メニュー" }).click();
    await page.screenshot({
      path: "test-results/same-name-switcher-390.png",
      fullPage: true,
    });
    const switcher = page.getByRole("combobox", {
      name: "プロジェクト切り替え",
    });
    for (const project of projects)
      await expect(
        switcher.locator(`option[value="${project.id}"]`),
      ).toHaveText(labels.get(project.id)!);
    await switcher.selectOption(projects[2].id);
    await expect(page).toHaveURL(`/projects/${projects[2].id}/overview`);
    await expect(page.getByLabel("用途", { exact: true })).toHaveValue(
      projects[2].purpose,
    );

    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: (await response.json()).reverse(),
      });
    });
    await page.goto("/projects");
    await checkRows(
      projects.map((project) => project.id),
      false,
    );
    const archived = projects[1];
    await rowFor(archived.id)
      .getByRole("button", {
        name: `${labels.get(archived.id)}をアーカイブ`,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
    await checkRows([archived.id], true);
    await page.goto(`/projects/${archived.id}/overview`);
    await page.getByRole("button", { name: "メニュー" }).click();
    await expect(
      page
        .getByRole("combobox", { name: "プロジェクト切り替え" })
        .locator(`option[value="${archived.id}"]`),
    ).toHaveText(`${labels.get(archived.id)}（アーカイブ）`);
  } finally {
    await page.unroute("**/api/projects");
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
