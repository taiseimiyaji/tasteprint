import { test, expect } from "@playwright/test";

for (const width of [1440, 390])
  for (const externalArchived of [false, true])
    test(`Observed external ${externalArchived ? "archive" : "unarchive"} survives an older reply and failed follow-up GET at ${width}`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 1050 });
      const project = await (
        await page.request.post("/api/projects", {
          data: {
            brief: { name: `Observed archive ${externalArchived} ${width}` },
            useTaste: false,
          },
        })
      ).json();
      const base = `/api/projects/${project.id}`;
      const initialVersion = externalArchived ? 1 : 0;
      if (externalArchived)
        expect(
          (
            await page.request.post(`${base}/archive`, {
              data: { baseRevision: 1, archived: true },
            })
          ).ok(),
        ).toBe(true);
      let readsFail = false;
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((r) => (entered = r));
      const held = new Promise<void>((r) => (release = r));
      let browserPosts = 0;
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().endsWith("/archive"))
          browserPosts++;
      });
      await page.route("**/api/projects", async (route) => {
        if (readsFail && route.request().method() === "GET")
          await route.fulfill({
            status: 503,
            json: { message: "FOLLOWUP_READ_FAILED" },
          });
        else await route.continue();
      });
      await page.route(`**${base}`, async (route) => {
        if (readsFail && route.request().method() === "GET")
          await route.fulfill({
            status: 503,
            json: { message: "PROJECT_READ_FAILED" },
          });
        else await route.continue();
      });
      await page.route(`**${base}/archive`, async (route) => {
        const response = await route.fetch();
        entered();
        await held;
        await route.fulfill({ response });
      });
      // Seed the separate Project cache, then observe the newer status only in
      // the collection GET. The late reply must reconcile both caches.
      await page.goto(`/projects/${project.id}/overview`);
      await expect(
        page.getByRole("heading", { name: project.brief.name, exact: true }),
      ).toBeVisible();
      if (width === 390)
        await page
          .getByRole("button", { name: "メニュー", exact: true })
          .click();
      await page
        .locator("nav")
        .getByRole("link", { name: "プロジェクト", exact: true })
        .click();
      if (externalArchived)
        await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
      const row = page.locator(".project-list article").filter({
        has: page.getByRole("heading", {
          name: project.brief.name,
          exact: true,
        }),
      });
      await expect(row).toHaveCount(1);
      await page.clock.install();
      const archiveReply = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${base}/archive` &&
          r.request().method() === "POST",
      );
      await row
        .getByRole("button", {
          name: `Observed archive ${externalArchived} ${width}を${externalArchived ? "アーカイブ解除" : "アーカイブ"}`,
          exact: true,
        })
        .click();
      await started;
      try {
        const external = await page.request.post(`${base}/archive`, {
          data: { baseRevision: 1, archived: externalArchived },
        });
        expect(external.ok()).toBe(true);
        const externalState = await external.json();
        expect(externalState.archiveVersion).toBe(initialVersion + 2);
        await page.clock.runFor(31000);
        const observedRead = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/projects" &&
            r.request().method() === "GET" &&
            r.status() === 200,
        );
        await page.evaluate(() =>
          window.dispatchEvent(new Event("visibilitychange")),
        );
        const observed = (await (await observedRead).json()).find(
          (p: { id: string }) => p.id === project.id,
        );
        expect(observed.archiveVersion).toBe(initialVersion + 2);
        expect(Boolean(observed.archivedAt)).toBe(externalArchived);
        await expect(row).toHaveCount(1);
        readsFail = true;
        const failedRead = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/projects" &&
            r.request().method() === "GET" &&
            r.status() === 503,
        );
        release();
        const old = await (await archiveReply).json();
        expect(old.archiveVersion).toBe(initialVersion + 1);
        expect(Boolean(old.archivedAt)).toBe(!externalArchived);
        await failedRead;
        await page.clock.runFor(2500);
        await expect(row).toHaveCount(1);
        await expect(
          page.getByRole("status").filter({ hasText: "変更は受理されました" }),
        ).toContainText("別の更新を反映した最新状態");
        const canonical = (await (await page.request.get(base)).json()).project;
        expect(Boolean(canonical.archivedAt)).toBe(externalArchived);
        expect(canonical.activeRevision).toBe(1);
        expect(canonical.archiveVersion).toBe(initialVersion + 2);
        expect(browserPosts).toBe(1);
        await row.getByRole("link", { name: /を再開$/ }).click();
        await expect(
          page.getByRole("alert").filter({ hasText: "PROJECT_READ_FAILED" }),
        ).toBeVisible();
        await expect(
          page.getByText(
            "アーカイブ中 · 変更するには一覧から解除してください",
            { exact: true },
          ),
        ).toHaveCount(externalArchived ? 1 : 0);
        expect(
          (await (await page.request.get("/api/health")).json()).codexCalls,
        ).toBe(0);
      } finally {
        release();
      }
    });
