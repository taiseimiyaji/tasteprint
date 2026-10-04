import { test, expect, type Page } from "@playwright/test";
function gate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>((r) => (enter = r)),
    held: new Promise<void>((r) => (release = r)),
    enter: () => enter(),
    release: () => release(),
  };
}
async function project(page: Page, name: string) {
  const r = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(r.ok()).toBe(true);
  const p = await r.json();
  return { id: p.id as string, base: `/api/projects/${p.id}` };
}
async function saveExternal(page: Page, base: string, accent: string) {
  const current = (await (await page.request.get(`${base}/foundation`)).json())
    .current;
  const r = await page.request.post(`${base}/foundation/save`, {
    data: {
      baseRevision: current.revision,
      design: { ...current.design, accent },
      reason: "Another tab saved this revision",
      requestId: crypto.randomUUID(),
    },
  });
  expect(r.ok()).toBe(true);
  return r.json();
}
async function background(
  page: Page,
  path: string,
  status: number,
  count: () => number = () => 1,
  expectedCount = 1,
) {
  const result = page.waitForResponse(
    (r) =>
      r.url().endsWith(path) &&
      r.request().method() === "GET" &&
      r.status() === status &&
      count() === expectedCount,
  );
  // Query staleness uses Date.now; keep real timers, including retry:1, running.
  await page.clock.setFixedTime(Date.now() + 35_000);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await (await result).finished();
}
function effects(page: Page, base: string) {
  let writes = 0,
    downloads = 0;
  const errors: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(base) && r.method() !== "GET") writes++;
  });
  page.on("download", () => downloads++);
  page.on("pageerror", (e) => errors.push(e.message));
  return { writes: () => writes, downloads: () => downloads, errors };
}
async function draft(page: Page, id: string) {
  return page.evaluate(
    (id) =>
      JSON.parse(
        localStorage.getItem(`tasteprint.scope.${id}.draft.v1`) || "null",
      ),
    id,
  );
}
for (const editor of ["profile", "overview", "foundation"] as const)
  for (const width of [1440, 390])
    test(`${editor} cached background failure recovers with GET and preserves its dirty draft at ${width}px`, async ({
      page,
    }) => {
      let startRevision = 1;
      const p = await project(page, `${editor} background recovery`),
        path = editor === "profile" ? "/api/profile" : p.base;
      await page.setViewportSize({ width, height: 1050 });
      await page.goto(
        editor === "profile" ? "/profile" : `/projects/${p.id}/${editor}`,
      );
      if (editor === "profile") {
        await page.getByLabel("density-0", { exact: true }).selectOption("a");
        await page
          .getByLabel("density-0 理由", { exact: true })
          .fill("My unsaved reason");
        const read = await (await page.request.get(path)).json();
        startRevision = read.current.revision;
        expect(
          (
            await page.request.post(path, {
              data: {
                ...read.current.snapshot,
                baseProfileRevision: read.current.revision,
                confirmed: true,
                answers: { "density-0": "b" },
              },
            })
          ).ok(),
        ).toBe(true);
      } else if (editor === "overview") {
        await page
          .getByLabel("プロジェクト名", { exact: true })
          .fill("My unsaved project name");
        const read = await (await page.request.get(path)).json();
        expect(
          (
            await page.request.post(path, {
              data: {
                baseRevision: 1,
                brief: {
                  ...read.current.snapshot.brief,
                  name: "Externally saved name",
                },
                policies: read.current.snapshot.policies,
              },
            })
          ).ok(),
        ).toBe(true);
      } else {
        await page.getByLabel("accent", { exact: true }).fill("#334455");
        expect((await saveExternal(page, p.base, "#778899")).revision).toBe(2);
      }
      const e = effects(page, path),
        pending = gate();
      let mode: "fail" | "hold" | "success" = "fail",
        reads = 0;
      await page.route(`**${path}`, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        reads++;
        if (mode === "fail")
          return route.fulfill({
            status: 503,
            json: { message: "BACKGROUND_GET_FAILED" },
          });
        if (mode === "hold") {
          pending.enter();
          await pending.held;
        }
        await route.continue();
      });
      await background(
        page,
        path,
        503,
        () => reads,
        editor === "profile" ? 1 : 2,
      );
      const warning = page
        .getByRole("alert")
        .filter({ hasText: "BACKGROUND_GET_FAILED" });
      const retry = page.getByRole("button", {
        name:
          editor === "profile" ? "共通の好みを再取得" : "プロジェクトを再取得",
        exact: true,
      });
      await expect(warning).toBeVisible();
      await expect(retry).toBeEnabled();
      await warning.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/background-error-${editor}-${width}.png`,
      });
      const checkInput = async () => {
        if (editor === "profile") {
          await expect(
            page.getByLabel("density-0", { exact: true }),
          ).toHaveValue("a");
          await expect(
            page.getByLabel("density-0 理由", { exact: true }),
          ).toHaveValue("My unsaved reason");
        } else
          await expect(
            page.getByLabel(
              editor === "overview" ? "プロジェクト名" : "accent",
              { exact: true },
            ),
          ).toHaveValue(
            editor === "overview" ? "My unsaved project name" : "#334455",
          );
      };
      await checkInput();
      mode = "hold";
      try {
        await retry.click();
        await pending.entered;
        await expect(retry).toBeDisabled();
        const before = reads;
        await retry.evaluate((b: HTMLButtonElement) => b.click());
        expect(reads).toBe(before);
        await checkInput();
        mode = "success";
        pending.release();
        await expect(warning).toHaveCount(0);
        await checkInput();
        await expect(page.locator(".editor-actions")).toContainText(
          `${editor === "profile" ? "共通" : "設計"} r${startRevision + 1}`,
        );
        await expect(
          page.getByRole("button", {
            name: "最新の確定版を読み込む",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          page.getByRole("button", {
            name:
              editor === "profile"
                ? "共通の好みを保存"
                : editor === "overview"
                  ? "概要・方針を保存"
                  : "変更を保存",
            exact: true,
          }),
        ).toBeDisabled();
        if (editor === "foundation")
          expect((await draft(page, p.id)).baseRevision).toBe(1);
        else
          expect(
            await page.evaluate(
              (key) => JSON.parse(localStorage.getItem(key) || "null"),
              editor === "profile"
                ? "tasteprint.profile.draft"
                : `tasteprint.${p.id}.overview`,
            ),
          ).toMatchObject(
            editor === "profile"
              ? { baseProfileRevision: startRevision }
              : { baseRevision: 1 },
          );
        expect(e.writes()).toBe(0);
        expect(e.downloads()).toBe(0);
        expect(e.errors).toEqual([]);
        await page.locator(".editor-actions").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/background-recovered-${editor}-${width}.png`,
        });
      } finally {
        pending.release();
      }
    });

test("a successful newer Project read preserves candidate 2 and prompt, protects its old draft, and exports the latest saved revision", async ({
  page,
}) => {
  const p = await project(page, "Workspace successful background read");
  await page.goto(`/projects/${p.id}/foundation`);
  await page.locator("#prompt").fill("Make the corners calmer");
  await page.getByRole("button", { name: "提案を依頼", exact: true }).click();
  const candidate = page.getByRole("button", { name: "候補 2", exact: true });
  await candidate.click();
  await page.locator("#prompt").fill("Unsent next request");
  expect((await saveExternal(page, p.base, "#778899")).revision).toBe(2);
  const e = effects(page, p.base);
  await background(page, p.base, 200);
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await expect(candidate).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#prompt")).toHaveValue("Unsent next request");
  const stored = await draft(page, p.id);
  expect(stored.baseRevision).toBe(1);
  expect(stored.design.accent).not.toBe("#778899");
  await expect(
    page.getByRole("button", { name: "最新の確定版を読み込む", exact: true }),
  ).toBeEnabled();
  expect(e.writes()).toBe(0);
  await page
    .locator("nav")
    .getByRole("link", { name: "Export", exact: true })
    .click();
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  const reply = page.waitForResponse(
    (r) =>
      r.url().endsWith(`${p.base}/exports`) && r.request().method() === "POST",
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await downloaded;
  expect((await (await reply).json()).revision).toBe(2);
  expect(e.writes()).toBe(1);
  expect(e.errors).toEqual([]);
});

test("a Foundation GET started before a newer Project reply cannot roll its saved version back", async ({
  page,
}) => {
  const p = await project(page, "Workspace old GET after parent read"),
    old = gate();
  await page.route(`**${p.base}/foundation`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    old.enter();
    await old.held;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/projects/${p.id}/foundation`);
    await old.entered;
    await page.getByLabel("accent", { exact: true }).fill("#334455");
    await saveExternal(page, p.base, "#778899");
    await background(page, p.base, 200);
    await expect(page.locator(".save-status")).toContainText("設計 r2");
    const returned = page.waitForResponse(
      (r) =>
        r.url().endsWith(`${p.base}/foundation`) &&
        r.request().method() === "GET",
    );
    old.release();
    await (await returned).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator(".save-status")).toContainText("設計 r2");
    await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
      "#334455",
    );
    expect((await draft(page, p.id)).baseRevision).toBe(1);
  } finally {
    old.release();
  }
});

test("equal and lower Project reads never roll the Workspace saved revision back or reset its draft", async ({
  page,
}) => {
  const p = await project(page, "Workspace lower parent read");
  const old = await (await page.request.get(p.base)).json();
  await page.goto(`/projects/${p.id}/foundation`);
  await page.getByLabel("accent", { exact: true }).fill("#334455");
  await saveExternal(page, p.base, "#778899");
  await background(page, p.base, 200);
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await background(page, p.base, 200);
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await page.route(`**${p.base}`, (r) => r.fulfill({ json: old }));
  await background(page, p.base, 200);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
    "#334455",
  );
  expect((await draft(page, p.id)).baseRevision).toBe(1);
});

for (const operation of ["manual", "review"] as const)
  test(`newer external r3 waits for a held ${operation} r2 reply and then keeps its accepted draft at base r2`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const p = await project(
        page,
        `Workspace ${operation} deferred parent read`,
      ),
      pending = gate();
    let accepted: { revision: number; design: { accent: string } };
    await page.goto(
      `/projects/${p.id}/${operation === "manual" ? "foundation" : "review"}`,
    );
    if (operation === "manual")
      await page.getByLabel("accent", { exact: true }).fill("#334455");
    else {
      await page
        .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
        .click();
      await expect(
        page.getByText("要判断の指摘数:", { exact: false }),
      ).toBeVisible({ timeout: 90000 });
      await page
        .getByRole("button", { name: "修正案を作成", exact: true })
        .click();
      await page
        .getByRole("button", { name: "仮Preview:", exact: false })
        .first()
        .click();
    }
    const path = `${p.base}/foundation/${operation === "manual" ? "save" : "apply"}`;
    await page.route(`**${path}`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      accepted = await response.json();
      expect(accepted.revision).toBe(2);
      pending.enter();
      await pending.held;
      await route.fulfill({ response });
    });
    try {
      await page
        .getByRole("button", {
          name: operation === "manual" ? "変更を保存" : "まとめて適用",
          exact: true,
        })
        .click();
      await pending.entered;
      expect((await saveExternal(page, p.base, "#556677")).revision).toBe(3);
      await background(page, p.base, 200);
      await expect(page.locator(".save-status")).toContainText("設計 r1");
      pending.release();
      await expect(page.locator(".save-status")).toContainText("設計 r3");
      const savedDraft = await draft(page, p.id);
      expect(savedDraft.baseRevision).toBe(2);
      expect(savedDraft.design.accent).toBe(accepted!.design.accent);
      expect(savedDraft.design.accent).not.toBe("#556677");
      await page
        .locator("nav")
        .getByRole("link", { name: "Foundation", exact: true })
        .click();
      await expect(page.locator(".save-status")).toContainText("設計 r3");
      await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
        accepted!.design.accent,
      );
      await expect(
        page.getByRole("button", {
          name: "最新の確定版を読み込む",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "変更を保存", exact: true }),
      ).toBeDisabled();
      expect(
        (await (await page.request.get(p.base)).json()).current.revision,
      ).toBe(3);
    } finally {
      pending.release();
    }
  });
