import { expect, test, type Page } from "@playwright/test";

function gate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>((resolve) => (enter = resolve)),
    held: new Promise<void>((resolve) => (release = resolve)),
    enter: () => enter(),
    release: () => release(),
  };
}

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  if (await menu.isVisible()) {
    if ((await menu.getAttribute("aria-expanded")) === "false")
      await menu.click();
  }
  await page.getByRole("link", { name, exact: true }).click();
}

for (const width of [1440, 390]) {
  for (const outcome of ["success", "failure"] as const) {
    test(`Profile remains editable after saving while its follow-up GET ends in ${outcome} at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      await page.goto("/profile");
      const initial = (await (await page.request.get("/api/profile")).json())
        .current;
      const reason = page.getByLabel("density-0 理由", { exact: true });
      const savedInput = `Saved before pending read ${width} ${outcome}`;
      const nextInput = `${savedInput} next unsaved edit`;
      await reason.fill(savedInput);
      const pending = gate();
      let posts = 0,
        fail = outcome === "failure";
      await page.route("**/api/profile", async (route) => {
        if (route.request().method() === "POST") {
          posts++;
          return route.continue();
        }
        if (posts === 0) return route.continue();
        pending.enter();
        await pending.held;
        if (fail)
          return route.fulfill({
            status: 503,
            json: { message: "POSTSAVE_READ_FAILED" },
          });
        return route.continue();
      });
      const actions = page.locator(".editor-actions");
      const save = actions.getByRole("button", {
        name: "共通の好みを保存",
        exact: true,
      });
      try {
        await save.click();
        await pending.entered;
        const accepted = (await (await page.request.get("/api/profile")).json())
          .current;
        expect(accepted.revision).toBe(initial.revision + 1);
        expect(accepted.snapshot.reasons["density-0"]).toBe(savedInput);
        await expect(actions).toContainText(
          `保存済み · 共通 r${accepted.revision}`,
        );
        await expect(reason).toBeEnabled();
        await reason.fill(nextInput);
        await navigate(page, "プロジェクト");
        await expect(page).toHaveURL(/\/projects$/);
        await navigate(page, "自分の好み");
        await expect(reason).toHaveValue(nextInput);
        await expect(actions).toContainText(
          `下書き・未保存 · 共通 r${accepted.revision}`,
        );
        expect(posts).toBe(1);
        const settled = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/profile") && r.request().method() === "GET",
        );
        pending.release();
        await (await settled).finished();
        if (fail) {
          const warning = page
            .getByRole("alert")
            .filter({ hasText: "POSTSAVE_READ_FAILED" });
          await expect(warning).toBeVisible();
          await expect(actions).not.toContainText("保存失敗");
          const retry = page.getByRole("button", {
            name: "共通の好みを再取得",
            exact: true,
          });
          await expect(retry).toBeEnabled();
          fail = false;
          await retry.click();
          await expect(warning).toHaveCount(0);
        }
        await expect(reason).toHaveValue(nextInput);
        await expect(reason).toBeEnabled();
        await expect(actions).not.toContainText("古い版・確認が必要");
        expect(posts).toBe(1);
        // Only a second explicit save may create the next revision.
        await save.click();
        await expect(actions).toContainText(
          `保存済み · 共通 r${accepted.revision + 1}`,
        );
        const savedAgain = (
          await (await page.request.get("/api/profile")).json()
        ).current;
        expect(savedAgain.revision).toBe(accepted.revision + 1);
        expect(savedAgain.snapshot.reasons["density-0"]).toBe(nextInput);
        expect(posts).toBe(2);
      } finally {
        pending.release();
      }
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
  }

  test(`Profile preserves a new draft when its post-save GET observes an external revision at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    await page.goto("/profile");
    const reason = page.getByLabel("density-0 理由", { exact: true });
    await reason.fill(`First saved input ${width}`);
    const pending = gate();
    let posts = 0;
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        return route.continue();
      }
      if (posts === 0) return route.continue();
      pending.enter();
      await pending.held;
      return route.continue();
    });
    const actions = page.locator(".editor-actions");
    const save = actions.getByRole("button", {
      name: "共通の好みを保存",
      exact: true,
    });
    try {
      await save.click();
      await pending.entered;
      await expect(reason).toBeEnabled();
      const accepted = (await (await page.request.get("/api/profile")).json())
        .current;
      const nextInput = `Unsaved while GET pending ${width}`;
      await reason.fill(nextInput);
      const externalInput = `Another tab saved ${width}`;
      const external = await page.request.post("/api/profile", {
        data: {
          ...accepted.snapshot,
          baseProfileRevision: accepted.revision,
          reasons: { ...accepted.snapshot.reasons, "density-0": externalInput },
        },
      });
      expect(external.ok()).toBe(true);
      const newer = await external.json();
      expect(newer.revision).toBe(accepted.revision + 1);
      pending.release();
      await expect(actions).toContainText(
        `古い版・確認が必要 · 共通 r${newer.revision}`,
      );
      await expect(reason).toHaveValue(nextInput);
      await expect(save).toBeDisabled();
      expect(posts).toBe(1);
      const server = (await (await page.request.get("/api/profile")).json())
        .current;
      expect(server.revision).toBe(newer.revision);
      expect(server.snapshot.reasons["density-0"]).toBe(externalInput);
      await actions
        .getByRole("button", { name: "最新の確定版を読み込む", exact: true })
        .click();
      await expect(reason).toHaveValue(externalInput);
      await expect(actions).toContainText(`保存済み · 共通 r${newer.revision}`);
      await expect(save).toBeEnabled();
    } finally {
      pending.release();
    }
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
