import { test, expect } from "@playwright/test";

for (const [width, readFails, initialReadPending] of [
  [1440, false, false],
  [390, false, false],
  [1440, true, false],
  [390, true, false],
  [1440, false, true],
  [390, false, true],
] as const) {
  test(`late successful project creation preserves a newer draft and refreshes its list${readFails ? " after a failed GET" : ""}${initialReadPending ? " with a pending initial GET" : ""} at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    let releaseInitialRead = () => {};
    let initialDelivered = Promise.resolve();
    if (initialReadPending) {
      await page.addInitScript(() =>
        localStorage.setItem("tasteprint.projects.migrated.v1", "complete"),
      );
      let entered!: () => void, release!: () => void, delivered!: () => void;
      const started = new Promise<void>((resolve) => (entered = resolve));
      const held = new Promise<void>((resolve) => (release = resolve));
      initialDelivered = new Promise<void>((resolve) => (delivered = resolve));
      releaseInitialRead = release;
      let first = true;
      await page.route("**/api/projects", async (route) => {
        if (route.request().method() !== "GET" || !first)
          return route.continue();
        first = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        entered();
        await held;
        try {
          await route.fulfill({ response });
        } finally {
          delivered();
        }
      });
      await page.goto("/profile");
      await started;
    } else {
      await page.goto("/profile");
    }
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
    let failListRead = false,
      listReads = 0;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") {
        listReads++;
        if (failListRead)
          return route.fulfill({
            status: 503,
            json: { message: "LATE_CREATE_LIST_READ_FAILED" },
          });
        return route.continue();
      }
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
      const readsBeforeReply = listReads;
      failListRead = readFails;
      release();
      await (await reply).finished();
      if (initialReadPending) {
        await expect.poll(() => listReads).toBeGreaterThan(readsBeforeReply);
        releaseInitialRead();
        await initialDelivered;
      }
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
      if (readFails) {
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "LATE_CREATE_LIST_READ_FAILED" }),
        ).toBeVisible();
        expect(posts).toBe(1);
        expect(await storage()).toEqual(newerStorage);
        failListRead = false;
        await page
          .getByRole("button", { name: "一覧を再読み込み", exact: true })
          .click();
      }
      await page
        .getByLabel("プロジェクトを検索", { exact: true })
        .fill(firstName);
      await expect(
        page
          .locator(".project-list")
          .getByRole("heading", { name: firstName, exact: true }),
      ).toBeVisible();
      expect(listReads).toBeGreaterThan(readsBeforeReply);
      const row = page.locator(".project-list article").filter({
        has: page.getByRole("heading", { name: firstName, exact: true }),
      });
      await expect(row).toHaveCount(1);
      await row.getByRole("link", { name: "再開", exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${accepted!.id}/overview$`),
      );
      await expect(
        page.getByRole("heading", { name: firstName, exact: true }),
      ).toBeVisible();
      expect(await storage()).toEqual(newerStorage);
      await page.goBack();
      await page.waitForURL("**/projects");
      await expect(
        page.getByRole("button", { name: "新規プロジェクト", exact: true }),
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
      releaseInitialRead();
      release();
    }
  });
}

for (const width of [1440, 390])
  for (const changed of ["brief", "taste", "both"] as const)
    test(`successful creation keeps a peer tab's newer ${changed} draft at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/projects");
      await page
        .getByRole("button", { name: "新規プロジェクト", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const firstName = `Committed owner ${crypto.randomUUID()}`;
      const peerName = `Unsent peer ${crypto.randomUUID()}`;
      await dialog
        .getByLabel("プロジェクト名", { exact: true })
        .fill(firstName);
      await dialog.getByLabel("共通の好みを使う", { exact: true }).check();
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => (entered = resolve));
      const held = new Promise<void>((resolve) => (release = resolve));
      let accepted: { id: string } | undefined;
      let posts = 0;
      await page.route("**/api/projects", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        posts++;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        accepted = await response.json();
        entered();
        await held;
        await route.fulfill({ response });
      });
      await dialog
        .getByRole("button", { name: "プロジェクトを作成", exact: true })
        .click();
      await started;
      const peer = await context.newPage();
      try {
        await peer.setViewportSize({ width, height: 1000 });
        await peer.goto("/projects");
        await peer
          .getByRole("button", { name: "新規プロジェクト", exact: true })
          .click();
        const peerDialog = peer.getByRole("dialog");
        await expect(
          peerDialog.getByLabel("プロジェクト名", { exact: true }),
        ).toHaveValue(firstName);
        if (changed !== "taste")
          await peerDialog
            .getByLabel("プロジェクト名", { exact: true })
            .fill(peerName);
        if (changed !== "brief")
          await peerDialog
            .getByLabel("共通の好みを使う", { exact: true })
            .uncheck();
        const storage = () =>
          peer.evaluate(() => ({
            brief: localStorage.getItem("tasteprint.new-project"),
            taste: localStorage.getItem("tasteprint.new-project.use-taste"),
          }));
        await expect
          .poll(async () => {
            const raw = await storage();
            return {
              name: raw.brief && JSON.parse(raw.brief).name,
              taste: raw.taste,
            };
          })
          .toEqual({
            name: changed === "taste" ? firstName : peerName,
            taste: changed === "brief" ? "true" : "false",
          });
        const newer = await storage();
        await expect(
          dialog
            .getByRole("alert")
            .filter({ hasText: "の下書きが別タブ・別画面で変更されています" })
            .first(),
        ).toBeVisible();
        release();
        await expect(page).toHaveURL(
          new RegExp(`/projects/${accepted!.id}/overview$`),
        );
        // Each key is cleaned only if its raw bytes still match this request.
        expect(await storage()).toEqual({
          brief: changed === "taste" ? null : newer.brief,
          taste: changed === "brief" ? null : newer.taste,
        });
        await expect(
          peerDialog.getByLabel("プロジェクト名", { exact: true }),
        ).toHaveValue(changed === "taste" ? firstName : peerName);
        if (changed !== "brief")
          await expect(
            peerDialog.getByLabel("共通の好みを使う", { exact: true }),
          ).not.toBeChecked();
        expect(posts).toBe(1);
        const projects = await (await page.request.get("/api/projects")).json();
        expect(
          projects.filter((p: { id: string }) => p.id === accepted!.id),
        ).toHaveLength(1);
        expect(
          projects.some(
            (p: { brief: { name: string } }) => p.brief.name === peerName,
          ),
        ).toBe(false);
        expect(
          (await (await page.request.get("/api/health")).json()).codexCalls,
        ).toBe(0);
      } finally {
        release();
        await peer.close();
      }
    });
