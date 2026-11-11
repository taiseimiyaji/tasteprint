import { expect, test, type Page } from "@playwright/test";

function gate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>((r) => (enter = r)),
    held: new Promise<void>((r) => (release = r)),
    enter: () => enter(),
    release: () => release(),
  };
}

async function list(page: Page) {
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute("aria-expanded")) === "false"
  )
    await menu.click();
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function reopen(page: Page, name: string) {
  await page
    .locator(".project-list article")
    .filter({
      has: page.getByRole("heading", { name, exact: true }),
    })
    .getByRole("link", { name: /再開/ })
    .click();
}

async function fixture(page: Page, width: number, target: "project" | "list") {
  await page.setViewportSize({ width, height: 1050 });
  const p = await (
    await page.request.post("/api/projects", {
      data: {
        brief: {
          name: `Overview read ${width} ${target} ${crypto.randomUUID()}`,
        },
        useTaste: false,
      },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const savedName = `${p.brief.name} saved`;
  await page.goto(`/projects/${p.id}/overview`);
  await page.getByLabel("プロジェクト名", { exact: true }).fill(savedName);
  const purpose = page.getByLabel("用途", { exact: true });
  await purpose.fill("Saved purpose");
  let posts = 0,
    accepted = false,
    fail = false;
  const pending = gate();
  for (const path of [base, "/api/projects"])
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() === "POST" && path === base) {
        posts++;
        const response = await route.fetch();
        if (response.ok()) accepted = true;
        return route.fulfill({ response });
      }
      if (!accepted || path !== (target === "project" ? base : "/api/projects"))
        return route.continue();
      pending.enter();
      await pending.held;
      if (fail)
        return route.fulfill({
          status: 503,
          json: { message: "OVERVIEW_POSTSAVE_READ_FAILED" },
        });
      return route.continue();
    });
  const actions = page.locator(".editor-actions");
  const save = actions.getByRole("button", {
    name: "概要・方針を保存",
    exact: true,
  });
  return {
    base,
    savedName,
    purpose,
    pending,
    actions,
    save,
    posts: () => posts,
    fail: (value: boolean) => (fail = value),
  };
}

for (const width of [1440, 390]) {
  for (const target of ["project", "list"] as const)
    for (const outcome of ["success", "failure"] as const)
      test(`Overview remains editable while its post-save ${target} GET ends in ${outcome} at ${width}`, async ({
        page,
      }) => {
        const f = await fixture(page, width, target);
        f.fail(outcome === "failure");
        try {
          await f.save.click();
          await f.pending.entered;
          const accepted = (await (await page.request.get(f.base)).json())
            .current;
          expect(accepted.revision).toBe(2);
          expect(accepted.snapshot.brief.name).toBe(f.savedName);
          expect(accepted.snapshot.brief.purpose).toBe("Saved purpose");
          await expect(f.actions).toContainText("保存済み · 設計 r2");
          await expect(
            page.getByLabel("プロジェクト切り替え").locator("option:checked"),
          ).toHaveText(f.savedName);
          await expect(f.purpose).toBeEnabled();
          const next = `Next draft ${target} ${outcome} ${width}`;
          await f.purpose.fill(next);
          await list(page);
          const card = page.locator(".project-list article").filter({
            has: page.getByRole("heading", {
              name: f.savedName,
              exact: true,
            }),
          });
          await expect(card).toContainText("設計 r2");
          await reopen(page, f.savedName);
          await expect(f.purpose).toHaveValue(next);
          await expect(f.actions).toContainText("下書き・未保存 · 設計 r2");
          expect(f.posts()).toBe(1);
          const settled = page.waitForResponse(
            (r) =>
              r.request().method() === "GET" &&
              r.url().endsWith(target === "project" ? f.base : "/api/projects"),
          );
          f.pending.release();
          await (await settled).finished();
          if (outcome === "failure") {
            if (target === "list") await list(page);
            const warning = page
              .getByRole("alert")
              .filter({ hasText: "OVERVIEW_POSTSAVE_READ_FAILED" });
            await expect(warning).toBeVisible();
            const retry = page.getByRole("button", {
              name:
                target === "project"
                  ? "プロジェクトを再取得"
                  : "一覧を再読み込み",
              exact: true,
            });
            await expect(retry).toBeEnabled();
            f.fail(false);
            await retry.click();
            await expect(warning).toHaveCount(0);
            if (target === "list") await reopen(page, f.savedName);
          }
          await expect(f.purpose).toHaveValue(next);
          await expect(f.actions).not.toContainText("保存失敗");
          await expect(f.save).toBeEnabled();
          expect(f.posts()).toBe(1);
          // The following explicit save, not background recovery, creates r3.
          await f.save.click();
          await expect(f.actions).toContainText("保存済み · 設計 r3");
          const saved = (await (await page.request.get(f.base)).json()).current;
          expect(saved.revision).toBe(3);
          expect(saved.snapshot.brief.purpose).toBe(next);
          expect(saved.snapshot.policies).toEqual(accepted.snapshot.policies);
          expect(saved.design).toEqual(accepted.design);
          expect(f.posts()).toBe(2);
        } finally {
          f.pending.release();
        }
        expect(
          (await (await page.request.get("/api/health")).json()).codexCalls,
        ).toBe(0);
      });

  test(`Overview retains a new draft and rejects an external revision conflict while its post-save GET is pending at ${width}`, async ({
    page,
  }) => {
    const f = await fixture(page, width, "project");
    try {
      await f.save.click();
      await f.pending.entered;
      await expect(f.purpose).toBeEnabled();
      const accepted = (await (await page.request.get(f.base)).json()).current;
      const next = `Keep conflicting draft ${width}`,
        externalPurpose = `Another tab saved ${width}`;
      await f.purpose.fill(next);
      const external = await page.request.post(f.base, {
        data: {
          baseRevision: accepted.revision,
          brief: { ...accepted.snapshot.brief, purpose: externalPurpose },
          policies: accepted.snapshot.policies,
        },
      });
      expect(external.ok()).toBe(true);
      expect((await external.json()).revision).toBe(3);
      const rejected = page.waitForResponse(
        (r) =>
          r.url().endsWith(f.base) &&
          r.request().method() === "POST" &&
          r.status() === 409,
      );
      await f.save.click();
      await rejected;
      f.pending.release();
      await expect(f.actions).toContainText("古い版・確認が必要 · 設計 r3");
      await expect(f.purpose).toHaveValue(next);
      await expect(f.purpose).toBeEnabled();
      await expect(f.save).toBeDisabled();
      const current = (await (await page.request.get(f.base)).json()).current;
      expect(current.revision).toBe(3);
      expect(current.snapshot.brief.purpose).toBe(externalPurpose);
      expect(f.posts()).toBe(2);
      await f.actions
        .getByRole("button", { name: "最新の確定版を読み込む", exact: true })
        .click();
      await expect(f.purpose).toHaveValue(externalPurpose);
      await expect(f.actions).toContainText("保存済み · 設計 r3");
      expect(f.posts()).toBe(2);
    } finally {
      f.pending.release();
    }
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  });
}
