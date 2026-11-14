import { expect, test, type Page, type Response } from "@playwright/test";

async function settled(page: Page, response: Response) {
  await response.finished();
  // Flush completed fetch callbacks and React rendering before unchanged-state checks.
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}

function gate() {
  let release!: () => void, enter!: () => void;
  return {
    held: new Promise<void>((r) => (release = r)),
    started: new Promise<void>((r) => (enter = r)),
    release: () => release(),
    enter: () => enter(),
  };
}
async function setup(page: Page) {
  const p = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name: "Foundation supplementary history" },
        useTaste: false,
      },
    })
  ).json();
  const base = `/api/projects/${p.id}/foundation`;
  await page.goto(`/projects/${p.id}/foundation`);
  const input = page.getByRole("textbox", { name: "accent", exact: true });
  await expect(input).toBeEnabled();
  const save = page.getByRole("button", { name: "変更を保存", exact: true });
  const draft = () =>
    page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem(`tasteprint.scope.${id}.draft.v1`)!),
      p.id,
    );
  const current = async () =>
    (await (await page.request.get(base)).json()).current;
  return { p, base, input, save, draft, current };
}
const warning = (page: Page) =>
  page.getByText("設計は保存済みですが、履歴を更新できませんでした。", {
    exact: true,
  });

for (const width of [1440, 390])
  for (const fails of [false, true])
    test(`Foundation supplementary history ${fails ? "503" : "200"} permits next editing and protects the next pending save at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      const f = await setup(page);
      const firstPost = gate(),
        firstRead = gate(),
        nextPost = gate();
      let writes = 0,
        reads = 0;
      await page.route(`**${f.base}/save`, async (route) => {
        writes++;
        const pending = writes === 1 ? firstPost : nextPost;
        pending.enter();
        await pending.held;
        await route.continue();
      });
      await page.route(`**${f.base}`, async (route) => {
        if (route.request().method() !== "GET" || writes === 0)
          return route.continue();
        if (++reads !== 1) return route.continue();
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        firstRead.enter();
        await firstRead.held;
        return fails
          ? route.fulfill({
              status: 503,
              json: { message: "SUPPLEMENTARY_HISTORY_FAILED" },
            })
          : route.fulfill({ response });
      });
      try {
        await f.input.fill("#112233");
        await f.save.click();
        await firstPost.started;
        await expect(f.input).toBeDisabled();
        expect((await f.current()).revision).toBe(1);
        firstPost.release();
        await firstRead.started;
        await expect(page.locator(".editor-actions")).toContainText(
          "保存済み · 設計 r2",
        );
        await expect(f.input).toBeEnabled();
        await expect.poll(async () => (await f.draft()).baseRevision).toBe(2);
        expect((await f.current()).design).toEqual((await f.draft()).design);

        await f.input.fill("#445566");
        await f.save.click();
        await nextPost.started;
        await expect(f.input).toBeDisabled();
        const oldReply = page.waitForResponse(
          (r) => r.url().endsWith(f.base) && r.request().method() === "GET",
        );
        firstRead.release();
        await settled(page, await oldReply);
        if (fails) await expect(warning(page)).toBeVisible();
        else await expect.poll(() => reads).toBe(1);
        // The old completion must not unlock a later write still awaiting its POST.
        await expect(f.input).toBeDisabled();
        await expect(page.locator(".editor-actions")).toContainText(
          "保存中 · 設計 r2",
        );
        nextPost.release();
        await expect(page.locator(".editor-actions")).toContainText(
          "保存済み · 設計 r3",
        );
        await expect(f.input).toBeEnabled();
        await expect(f.input).toHaveValue("#445566");
        await expect.poll(async () => (await f.draft()).baseRevision).toBe(3);
        const r3 = await f.current();
        expect(r3.revision).toBe(3);
        expect(r3.design).toEqual((await f.draft()).design);
        await expect(warning(page)).toHaveCount(0);
        expect(writes).toBe(2);
      } finally {
        firstPost.release();
        firstRead.release();
        nextPost.release();
      }
    });

for (const olderFails of [false, true])
  test(`Late older history ${olderFails ? "failure" : "success"} cannot replace the newer history read status`, async ({
    page,
  }) => {
    const f = await setup(page),
      older = gate();
    let writes = 0,
      reads = 0;
    await page.route(`**${f.base}/save`, async (route) => {
      writes++;
      await route.continue();
    });
    await page.route(`**${f.base}`, async (route) => {
      if (route.request().method() !== "GET" || writes === 0)
        return route.continue();
      reads++;
      if (reads === 1) {
        const response = await route.fetch();
        older.enter();
        await older.held;
        return olderFails
          ? route.fulfill({
              status: 503,
              json: { message: "OLDER_HISTORY_FAILED" },
            })
          : route.fulfill({ response });
      }
      return olderFails
        ? route.continue()
        : route.fulfill({
            status: 503,
            json: { message: "NEWER_HISTORY_FAILED" },
          });
    });
    try {
      await f.input.fill("#112233");
      await f.save.click();
      await older.started;
      await expect(f.input).toBeEnabled();
      const nextRead = page.waitForResponse(
        (r) => r.url().endsWith(f.base) && r.request().method() === "GET",
      );
      await f.input.fill("#445566");
      await f.save.click();
      await expect(page.locator(".editor-actions")).toContainText(
        "保存済み · 設計 r3",
      );
      await settled(page, await nextRead);
      await expect.poll(() => reads).toBe(2);
      if (olderFails) await expect(warning(page)).toHaveCount(0);
      else await expect(warning(page)).toBeVisible();
      await f.input.fill("#778899");
      const olderResponse = page.waitForResponse(
        (r) => r.url().endsWith(f.base) && r.request().method() === "GET",
      );
      older.release();
      await settled(page, await olderResponse);
      if (olderFails) await expect(warning(page)).toHaveCount(0);
      else await expect(warning(page)).toBeVisible();
      await expect(f.input).toHaveValue("#778899");
      expect((await f.draft()).baseRevision).toBe(3);
      expect((await f.draft()).design.accent).toBe("#778899");
      expect((await f.current()).design.accent).toBe("#445566");
      expect(writes).toBe(2);
      if (!olderFails) {
        await page.unroute(`**${f.base}`);
        await page
          .getByRole("button", { name: "履歴を再取得", exact: true })
          .click();
        await expect(warning(page)).toHaveCount(0);
        await expect(f.input).toHaveValue("#778899");
        expect(writes).toBe(2);
      }
    } finally {
      older.release();
    }
  });

test("A newer external revision keeps the next Foundation draft stale after a late supplementary history", async ({
  page,
}) => {
  const f = await setup(page),
    pending = gate();
  let writes = 0;
  await page.route(`**${f.base}/save`, async (route) => {
    writes++;
    await route.continue();
  });
  await page.route(`**${f.base}`, async (route) => {
    if (writes === 0) return route.continue();
    const response = await route.fetch();
    pending.enter();
    await pending.held;
    return route.fulfill({ response });
  });
  try {
    await f.input.fill("#112233");
    await f.save.click();
    await pending.started;
    await expect(f.input).toBeEnabled();
    await f.input.fill("#445566");
    const r2 = await f.current();
    const changed = await page.request.post(`${f.base}/save`, {
      data: {
        baseRevision: 2,
        design: { ...r2.design, accent: "#778899" },
        reason: "Synthetic external revision",
        requestId: crypto.randomUUID(),
      },
    });
    expect(changed.ok()).toBe(true);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(page.locator(".editor-actions")).toContainText("設計 r3");
    await expect(f.save).toBeDisabled();
    const oldReply = page.waitForResponse(
      (r) => r.url().endsWith(f.base) && r.request().method() === "GET",
    );
    pending.release();
    await settled(page, await oldReply);
    await expect(page.locator(".editor-actions")).toContainText("設計 r3");
    await expect(f.input).toHaveValue("#445566");
    expect((await f.draft()).baseRevision).toBe(2);
    expect((await f.current()).revision).toBe(3);
    await expect(page.locator(".editor-actions")).toContainText(
      "下書きの版が古くなっています",
    );
    const rejected = await page.request.post(`${f.base}/save`, {
      data: {
        baseRevision: 2,
        design: (await f.draft()).design,
        reason: "Synthetic stale save",
        requestId: crypto.randomUUID(),
      },
    });
    expect(rejected.status()).toBe(409);
    expect((await f.current()).design.accent).toBe("#778899");
    expect(writes).toBe(1);
  } finally {
    pending.release();
  }
});
