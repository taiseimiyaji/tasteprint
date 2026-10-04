import { test, expect, type Page } from "@playwright/test";
function gate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>((resolve) => (enter = resolve)),
    held: new Promise<void>((resolve) => (release = resolve)),
    enter: () => enter(),
    release: () => release(),
  };
}
async function project(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  const p = await response.json();
  return { id: p.id as string, base: `/api/projects/${p.id}` };
}
async function openChat(page: Page) {
  if (!(await page.locator(".conversation").isVisible()))
    await page
      .getByRole("button", { name: "対話パネルを切り替え", exact: true })
      .click();
}
function countEffects(page: Page, base: string) {
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
for (const family of ["conversation", "export"] as const)
  for (const width of [1440, 390])
    test(`${family} initial failed history recovers with GET only at ${width}px`, async ({
      page,
    }) => {
      const p = await project(page, `${family} initial read recovery`);
      const message = "Saved history before failed initial GET";
      let file = "";
      if (family === "conversation") {
        expect(
          (
            await page.request.post(`${p.base}/conversations`, {
              data: { baseRevision: 1, text: message },
            })
          ).ok(),
        ).toBe(true);
      } else {
        const reply = await (
          await page.request.post(`${p.base}/exports`, {
            data: { baseRevision: 1 },
          })
        ).json();
        file = Object.keys(reply.files).find((n) => n.endsWith(".json"))!;
      }
      const effects = countEffects(page, p.base),
        pending = gate();
      let mode: "fail" | "hold" | "success" = "fail",
        reads = 0;
      const path = `${p.base}/${family === "conversation" ? "conversations" : "exports"}`;
      await page.route(`**${path}`, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        reads++;
        if (mode === "fail")
          return route.fulfill({
            status: 503,
            json: { message: "INITIAL_HISTORY_GET_FAILED" },
          });
        if (mode === "hold") {
          pending.enter();
          await pending.held;
        }
        await route.continue();
      });
      await page.setViewportSize({ width, height: 1050 });
      await page.goto(
        `/projects/${p.id}/${family === "conversation" ? "foundation" : "export"}`,
      );
      if (family === "conversation") {
        await page.getByLabel("accent", { exact: true }).fill("#334455");
        await openChat(page);
        await page.locator("#prompt").fill("Keep my next request unchanged");
      }
      const warning = page
        .getByRole("alert")
        .filter({ hasText: "INITIAL_HISTORY_GET_FAILED" });
      const retry = page.getByRole("button", {
        name:
          family === "conversation" ? "対話履歴を再取得" : "Export履歴を再取得",
        exact: true,
      });
      await expect(warning).toBeVisible();
      await expect(retry).toBeEnabled();
      expect(reads).toBe(2); // Existing retry:1 has finished before manual recovery.
      await page.screenshot({
        path: `test-results/history-error-${family}-${width}.png`,
        fullPage: false,
      });
      mode = "hold";
      try {
        await retry.click();
        await pending.entered;
        await expect(retry).toBeDisabled();
        await page.screenshot({
          path: `test-results/history-pending-${family}-${width}.png`,
          fullPage: false,
        });
        await retry.evaluate((button: HTMLButtonElement) => button.click());
        expect(reads).toBe(3);
        if (family === "conversation") {
          await expect(page.locator("#prompt")).toHaveValue(
            "Keep my next request unchanged",
          );
          await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
            "#334455",
          );
        }
        mode = "success";
        pending.release();
        await expect(warning).toHaveCount(0);
        if (family === "conversation") {
          await expect(
            page
              .locator(".conversation-content > p")
              .filter({ hasText: message }),
          ).toBeVisible();
          await expect(page.locator("#prompt")).toHaveValue(
            "Keep my next request unchanged",
          );
          await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
            "#334455",
          );
        } else
          await expect(
            page.getByRole("link", { name: file, exact: true }),
          ).toBeVisible();
        expect(effects.writes()).toBe(0);
        expect(effects.downloads()).toBe(0);
        expect(effects.errors).toEqual([]);
        expect(
          (await (await page.request.get(p.base)).json()).current.revision,
        ).toBe(1);
        await page.screenshot({
          path: `test-results/history-recovery-${family}-${width}.png`,
          fullPage: false,
        });
      } finally {
        pending.release();
      }
    });

test("conversation cached history and candidate 2 survive a failed GET and read-only retry", async ({
  page,
}) => {
  const p = await project(page, "Cached conversation recovery");
  const first = "Previously saved request",
    second = "Make the corners calmer";
  await page.request.post(`${p.base}/conversations`, {
    data: { baseRevision: 1, text: first },
  });
  await page.goto(`/projects/${p.id}/foundation`);
  await expect(
    page.locator(".conversation-content > p").filter({ hasText: first }),
  ).toBeVisible();
  const effects = countEffects(page, p.base),
    pending = gate();
  let mode: "fail" | "hold" | "success" = "fail";
  await page.route(`**${p.base}/conversations`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (mode === "fail")
      return route.fulfill({
        status: 503,
        json: { message: "CACHED_HISTORY_GET_FAILED" },
      });
    if (mode === "hold") {
      pending.enter();
      await pending.held;
    }
    await route.continue();
  });
  await page.locator("#prompt").fill(second);
  await page.getByRole("button", { name: "提案を依頼", exact: true }).click();
  const candidate = page.getByRole("button", { name: "候補 2", exact: true });
  await candidate.click();
  await page.locator("#prompt").fill("Unsent next request");
  const warning = page
    .getByRole("alert")
    .filter({ hasText: "CACHED_HISTORY_GET_FAILED" });
  await expect(warning).toBeVisible();
  for (const text of [first, second])
    await expect(
      page.locator(".conversation-content > p").filter({ hasText: text }),
    ).toBeVisible();
  const before = effects.writes();
  mode = "hold";
  try {
    const retry = page.getByRole("button", {
      name: "対話履歴を再取得",
      exact: true,
    });
    await retry.click();
    await pending.entered;
    await expect(retry).toBeDisabled();
    await expect(candidate).toHaveAttribute("aria-pressed", "true");
    mode = "success";
    pending.release();
    await expect(warning).toHaveCount(0);
    await expect(candidate).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#prompt")).toHaveValue("Unsent next request");
    expect(effects.writes()).toBe(before);
    expect(before).toBe(2);
    expect(effects.downloads()).toBe(0);
    expect(effects.errors).toEqual([]);
    expect(
      (await (await page.request.get(`${p.base}/conversations`)).json()).map(
        (m: { text: string }) => m.text,
      ),
    ).toEqual([first, second]);
    expect(
      (await (await page.request.get(p.base)).json()).current.revision,
    ).toBe(1);
  } finally {
    pending.release();
  }
});

test("conversation read recovery retains a failed proposal error and blocks retry while proposal is pending", async ({
  page,
}) => {
  const p = await project(page, "Conversation independent errors");
  await page.goto(`/projects/${p.id}/foundation`);
  await expect(page.getByLabel("accent", { exact: true })).toBeEnabled();
  const effects = countEffects(page, p.base),
    mutation = gate();
  let fail = true;
  await page.route(`**${p.base}/conversations`, async (route) => {
    if (fail && route.request().method() === "GET")
      return route.fulfill({
        status: 503,
        json: { message: "CONVERSATION_GET_FAILED" },
      });
    await route.continue();
  });
  await page.route(`**${p.base}/foundation/proposals`, async (route) => {
    mutation.enter();
    await mutation.held;
    await route.fulfill({
      status: 500,
      json: { message: "PROPOSAL_POST_FAILED" },
    });
  });
  await page.locator("#prompt").fill("Failed proposal request remains");
  try {
    await page.getByRole("button", { name: "提案を依頼", exact: true }).click();
    await mutation.entered;
    const retry = page.getByRole("button", {
      name: "対話履歴を再取得",
      exact: true,
    });
    await expect(retry).toBeDisabled();
    mutation.release();
    await expect(
      page.getByRole("alert").filter({ hasText: "PROPOSAL_POST_FAILED" }),
    ).toBeVisible();
    await expect(retry).toBeEnabled();
    const before = effects.writes();
    fail = false;
    await retry.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "CONVERSATION_GET_FAILED" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("alert").filter({ hasText: "PROPOSAL_POST_FAILED" }),
    ).toBeVisible();
    await expect(page.locator("#prompt")).toHaveValue(
      "Failed proposal request remains",
    );
    expect(effects.writes()).toBe(before);
    expect(before).toBe(2);
    expect(effects.errors).toEqual([]);
  } finally {
    mutation.release();
  }
});

test("Export GET recovery retains cached downloads and independent generation error without another export", async ({
  page,
}) => {
  const p = await project(page, "Cached export recovery");
  await page.goto(`/projects/${p.id}/export`);
  const effects = countEffects(page, p.base),
    update = gate();
  let posts = 0,
    fail = false;
  await page.route(`**${p.base}/exports`, async (route) => {
    if (route.request().method() === "GET") {
      if (fail)
        return route.fulfill({
          status: 503,
          json: { message: "EXPORT_GET_FAILED" },
        });
      return route.continue();
    }
    posts++;
    if (posts === 1) {
      const reply = await route.fetch();
      expect(reply.ok()).toBe(true);
      fail = true;
      return route.fulfill({ response: reply });
    }
    update.enter();
    await update.held;
    await route.fulfill({
      status: 500,
      json: { message: "EXPORT_POST_FAILED" },
    });
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await downloaded;
  const file = await page
    .getByRole("link", { name: /\.json$/ })
    .getAttribute("download");
  expect(file).toBeTruthy();
  const readError = page
    .getByRole("alert")
    .filter({ hasText: "EXPORT_GET_FAILED" });
  await expect(readError).toBeVisible();
  const retry = page.getByRole("button", {
    name: "Export履歴を再取得",
    exact: true,
  });
  try {
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    await update.entered;
    await expect(retry).toBeDisabled();
    update.release();
    await expect(
      page.getByRole("alert").filter({ hasText: "EXPORT_POST_FAILED" }),
    ).toBeVisible();
    await expect(readError).toBeVisible();
    await expect(retry).toBeEnabled();
    const before = effects.writes(),
      downloadsBefore = effects.downloads();
    fail = false;
    await retry.click();
    await expect(readError).toHaveCount(0);
    await expect(
      page.getByRole("alert").filter({ hasText: "EXPORT_POST_FAILED" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: file!, exact: true }),
    ).toBeVisible();
    expect(effects.writes()).toBe(before);
    expect(before).toBe(2);
    expect(posts).toBe(2);
    expect(effects.downloads()).toBe(downloadsBefore);
    expect(downloadsBefore).toBe(1);
    expect(effects.errors).toEqual([]);
    expect(
      (await (await page.request.get(`${p.base}/exports`)).json()).length,
    ).toBe(1);
    expect(
      (await (await page.request.get(p.base)).json()).current.revision,
    ).toBe(1);
  } finally {
    update.release();
  }
});
