import { expect, test, type Page, type Response } from "@playwright/test";

function gate() {
  let enter!: () => void, release!: () => void;
  return {
    started: new Promise<void>((r) => (enter = r)),
    held: new Promise<void>((r) => (release = r)),
    enter: () => enter(),
    release: () => release(),
  };
}
async function settled(page: Page, response: Response) {
  await response.finished();
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}
async function setup(page: Page) {
  const p = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name: "Proposal supplementary history" },
        useTaste: false,
      },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const initial = page.waitForResponse(
    (r) =>
      r.url().endsWith(`${base}/conversations`) &&
      r.request().method() === "GET",
  );
  await page.goto(`/projects/${p.id}/foundation`);
  await settled(page, await initial);
  const toggle = page.getByRole("button", {
    name: "対話パネルを切り替え",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  const submit = page.getByRole("button", { name: "提案を依頼", exact: true });
  const ask = async (text: string) => {
    await page.locator("#prompt").fill(text);
    await submit.click();
  };
  const messages = async () =>
    await (await page.request.get(`${base}/conversations`)).json();
  const revision = async () =>
    (await (await page.request.get(`${base}/foundation`)).json()).current
      .revision;
  const health = async () => {
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  };
  return { p, base, ask, submit, messages, revision, health };
}

for (const width of [1440, 390])
  for (const fails of [false, true])
    test(`Proposal auxiliary history ${fails ? "503" : "200"} cannot prevent generation after the saved conversation at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      const f = await setup(page),
        post = gate(),
        read = gate(),
        proposal = gate();
      let writes = 0,
        proposals = 0,
        armed = false,
        holding = true,
        failRead = fails;
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(`**${f.base}/conversations`, async (route) => {
        if (route.request().method() === "POST") {
          writes++;
          post.enter();
          await post.held;
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          armed = true;
          return route.fulfill({ response });
        }
        if (!armed) return route.continue();
        if (holding) {
          const response = await route.fetch();
          read.enter();
          await read.held;
          if (!failRead) return route.fulfill({ response });
        }
        return failRead
          ? route.fulfill({
              status: 503,
              json: { message: "SUPPLEMENTARY_CONVERSATION_FAILED" },
            })
          : route.continue();
      });
      await page.route(`**${f.base}/foundation/proposals`, async (route) => {
        proposals++;
        proposal.enter();
        await proposal.held;
        await route.continue();
      });
      const text = `Synthetic request ${width} ${fails}`;
      try {
        await f.ask(text);
        await post.started;
        expect(await f.messages()).toHaveLength(0);
        expect(proposals).toBe(0);
        await expect(f.submit).toBeDisabled();
        post.release();
        await read.started;
        // Generation must start while the auxiliary history response stays held.
        await expect.poll(() => proposals).toBe(1);
        await proposal.started;
        expect(await f.messages()).toHaveLength(1);
        await expect(
          page.locator(".conversation-content > p").filter({ hasText: text }),
        ).toBeVisible();
        await expect(f.submit).toBeDisabled();
        proposal.release();
        const candidate2 = page.getByRole("button", {
          name: "候補 2",
          exact: true,
        });
        await candidate2.click();
        await expect(candidate2).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByRole("button", { name: "採用する", exact: true }),
        ).toBeEnabled();
        await expect(f.submit).toBeEnabled();
        expect(holding).toBe(true);
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith(`${f.base}/conversations`) &&
            r.request().method() === "GET",
        );
        holding = false;
        read.release();
        await settled(page, await response);
        if (fails) {
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "SUPPLEMENTARY_CONVERSATION_FAILED" }),
          ).toBeVisible();
          failRead = false;
          await page
            .getByRole("button", { name: "対話履歴を再取得", exact: true })
            .click();
          await expect(
            page.getByText("SUPPLEMENTARY_CONVERSATION_FAILED", {
              exact: false,
            }),
          ).toHaveCount(0);
        }
        await expect(candidate2).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#prompt")).toHaveValue(text);
        expect(
          (await f.messages()).map((m: { text: string }) => m.text),
        ).toEqual([text]);
        expect(await f.revision()).toBe(1);
        expect(writes).toBe(1);
        expect(proposals).toBe(1);
        expect(errors).toEqual([]);
        await f.health();
      } finally {
        post.release();
        read.release();
        proposal.release();
      }
    });

test("Failed conversation saving never starts generation and preserves an explicit retry", async ({
  page,
}) => {
  const f = await setup(page);
  let fail = true,
    writes = 0,
    proposals = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().endsWith(`${f.base}/foundation/proposals`)
    )
      proposals++;
  });
  await page.route(`**${f.base}/conversations`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    return fail
      ? route.fulfill({
          status: 503,
          json: { message: "CONVERSATION_SAVE_FAILED" },
        })
      : route.continue();
  });
  const text = "Only generate after this request is saved";
  await f.ask(text);
  await expect(
    page.getByRole("alert").filter({ hasText: "CONVERSATION_SAVE_FAILED" }),
  ).toBeVisible();
  expect(await f.messages()).toHaveLength(0);
  expect(proposals).toBe(0);
  await expect(page.locator("#prompt")).toHaveValue(text);
  fail = false;
  await f.submit.click();
  await expect(
    page.getByRole("button", { name: "採用する", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(2);
  expect(proposals).toBe(1);
  expect(await f.messages()).toHaveLength(1);
  expect(await f.revision()).toBe(1);
  await f.health();
});

for (const olderFails of [false, true])
  test(`Later request and candidate survive the older supplementary history ${olderFails ? "failure" : "success"}`, async ({
    page,
  }) => {
    const f = await setup(page),
      older = gate();
    let writes = 0,
      proposals = 0,
      reads = 0;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        r.url().endsWith(`${f.base}/foundation/proposals`)
      )
        proposals++;
    });
    await page.route(`**${f.base}/conversations`, async (route) => {
      if (route.request().method() === "POST") {
        writes++;
        return route.continue();
      }
      if (writes === 0 || ++reads !== 1) return route.continue();
      const response = await route.fetch();
      older.enter();
      await older.held;
      return olderFails
        ? route.fulfill({
            status: 503,
            json: { message: "OLDER_CONVERSATION_FAILED" },
          })
        : route.fulfill({ response });
    });
    const first = "First synthetic request",
      second = "Second synthetic request";
    try {
      await f.ask(first);
      await older.started;
      await expect(
        page.getByRole("button", { name: "採用する", exact: true }),
      ).toBeEnabled();
      await f.ask(second);
      const candidate2 = page.getByRole("button", {
        name: "候補 2",
        exact: true,
      });
      await candidate2.click();
      await expect(candidate2).toHaveAttribute("aria-pressed", "true");
      const displayed = async () =>
        (
          await page.locator(".conversation-content > p").allTextContents()
        ).filter((s) => [first, second].includes(s));
      await expect.poll(displayed).toEqual([first, second]);
      const reply = page.waitForResponse(
        (r) =>
          r.url().endsWith(`${f.base}/conversations`) &&
          r.request().method() === "GET",
      );
      older.release();
      await settled(page, await reply);
      await expect.poll(displayed).toEqual([first, second]);
      await expect(candidate2).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#prompt")).toHaveValue(second);
      await expect(
        page.getByText("OLDER_CONVERSATION_FAILED", { exact: false }),
      ).toHaveCount(0);
      expect((await f.messages()).map((m: { text: string }) => m.text)).toEqual(
        [first, second],
      );
      expect(writes).toBe(2);
      expect(proposals).toBe(2);
      expect(await f.revision()).toBe(1);
      expect(errors).toEqual([]);
      await f.health();
    } finally {
      older.release();
    }
  });
