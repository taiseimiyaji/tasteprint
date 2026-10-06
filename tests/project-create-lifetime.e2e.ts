import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`late successful project creation preserves a newer draft after Back and reentry at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/profile");
    await expect(
      page.getByRole("button", { name: "共通の好みを保存", exact: true }),
    ).toBeVisible();
    const openProjects = async () => {
      if (width === 390)
        await page
          .getByRole("button", { name: "メニュー", exact: true })
          .click();
      await page
        .getByRole("navigation", { name: "アプリ全体" })
        .getByRole("link", { name: "プロジェクト", exact: true })
        .click();
      await page.waitForURL("**/projects");
    };
    await openProjects();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    let accepted: { id: string; brief: { name: string } } | undefined;
    let posts = 0;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      if (posts !== 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      accepted = await response.json();
      entered();
      await held;
      await route.fulfill({ response });
    });
    const firstName = `Earlier committed ${crypto.randomUUID()}`;
    const nextName = `New unsent ${crypto.randomUUID()}`;
    const openDialog = async () => {
      await page
        .getByRole("button", { name: "新規プロジェクト", exact: true })
        .click();
      return page.getByRole("dialog");
    };
    const first = await openDialog();
    await first.getByLabel("プロジェクト名", { exact: true }).fill(firstName);
    await first
      .getByRole("button", { name: "プロジェクトを作成", exact: true })
      .click();
    await started;
    try {
      await page.goBack();
      await page.waitForURL("**/profile");
      await expect(
        page.getByRole("button", { name: "共通の好みを保存", exact: true }),
      ).toBeVisible();
      await openProjects();
      const next = await openDialog();
      await next.getByLabel("プロジェクト名", { exact: true }).fill(nextName);
      await next.getByLabel("共通の好みを使う", { exact: true }).uncheck();
      const storage = () =>
        page.evaluate(() => ({
          brief: localStorage.getItem("tasteprint.new-project"),
          taste: localStorage.getItem("tasteprint.new-project.use-taste"),
        }));
      await expect
        .poll(async () => {
          const stored = await storage();
          return {
            name: stored.brief && JSON.parse(stored.brief).name,
            taste: stored.taste,
          };
        })
        .toEqual({ name: nextName, taste: "false" });
      const newerStorage = await storage();
      const reply = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/projects" &&
          response.request().method() === "POST",
      );
      release();
      await (await reply).finished();
      // Observe the old receipt long enough to catch its synchronous redirect.
      await page
        .waitForURL(`**/projects/${accepted!.id}/overview`, { timeout: 750 })
        .catch((error) => {
          if (error.name !== "TimeoutError") throw error;
        });
      await expect(page).toHaveURL(/\/projects$/);
      await expect(
        next.getByLabel("プロジェクト名", { exact: true }),
      ).toHaveValue(nextName);
      await expect(
        next.getByLabel("共通の好みを使う", { exact: true }),
      ).not.toBeChecked();
      expect(await storage()).toEqual(newerStorage);
      expect(posts).toBe(1);
      const projects = await (await page.request.get("/api/projects")).json();
      expect(
        projects.filter(
          (project: { id: string }) => project.id === accepted!.id,
        ),
      ).toHaveLength(1);
      expect(
        projects.some(
          (project: { brief: { name: string } }) =>
            project.brief.name === nextName,
        ),
      ).toBe(false);
      await page.keyboard.press("Escape");
      // The list is cached across routes; an ordinary reload reads the committed project.
      await page.reload();
      await expect(
        page
          .locator(".project-list")
          .getByRole("heading", { name: firstName, exact: true }),
      ).toBeVisible();
      const reopened = await openDialog();
      await expect(
        reopened.getByLabel("プロジェクト名", { exact: true }),
      ).toHaveValue(nextName);
      await reopened
        .getByRole("button", { name: "プロジェクトを作成", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: nextName, exact: true }),
      ).toBeVisible();
      expect(posts).toBe(2);
      expect(await storage()).toEqual({ brief: null, taste: null });
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    } finally {
      release();
    }
  });
}
