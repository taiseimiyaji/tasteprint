import { expect, test, type Page } from "@playwright/test";

async function chat(page: Page, open: boolean) {
  const navigation = page.getByRole("button", {
    name: "メニュー",
    exact: true,
  });
  if (
    (await navigation.isVisible()) &&
    (await navigation.getAttribute("aria-expanded")) === "true"
  )
    await navigation.click();
  const toggle = page.getByRole("button", {
    name: "対話パネルを切り替え",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== String(open)) {
    if (open) await toggle.click();
    else
      await page
        .getByRole("button", { name: "対話パネルを閉じる", exact: true })
        .click();
  }
}

async function menu(page: Page) {
  const button = page.getByRole("button", { name: "メニュー", exact: true });
  if (
    (await button.isVisible()) &&
    (await button.getAttribute("aria-expanded")) === "false"
  )
    await button.click();
}

async function exit(page: Page, blocked: boolean) {
  await chat(page, false);
  await menu(page);
  await page.getByRole("link", { name: "プロジェクト", exact: true }).click();
  if (blocked) {
    await expect(page).toHaveURL(/\/foundation$/);
    await expect(
      page.getByText(
        "リクエストの下書きを保存できなかったため、移動を中止しました。対話パネルで保存を再試行してください。",
        { exact: true },
      ),
    ).toBeVisible();
    await chat(page, true);
  } else await expect(page).toHaveURL(/\/projects$/);
}

async function denyPromptWrite(page: Page, key: string) {
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), key))
    .toBe("");
  await page.evaluate((key) => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("synthetic prompt quota", "QuotaExceededError");
      return native.call(this, name, value);
    };
  }, key);
}

async function prepared(
  page: Page,
  width = 1440,
  options: { rejectSecond?: boolean; sameText?: boolean } = {},
) {
  await page.setViewportSize({ width, height: 1050 });
  const p = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name: `Prompt acknowledgement ${crypto.randomUUID()}` },
        useTaste: false,
      },
    })
  ).json();
  const base = `/api/projects/${p.id}`,
    key = `tasteprint.${p.id}.prompt`;
  const a = options.sameText
    ? "  Repeated saved request  "
    : "OLD accepted request A";
  const b = options.sameText ? a : "NEW accepted request B";
  await page.goto(`/projects/${p.id}/foundation`);
  const accent = page.getByLabel("accent", { exact: true });
  await expect(accent).toBeEnabled();
  const originalAccent = await accent.inputValue();
  await chat(page, true);
  await denyPromptWrite(page, key);
  let posts = 0,
    proposals = 0,
    enter!: () => void,
    release!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const held = new Promise<void>((r) => (release = r));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (r) => {
    if (
      r.request().method() === "POST" &&
      r.url().endsWith(`${base}/foundation/proposals`)
    ) {
      await r.finished();
      proposals++;
    }
  });
  await page.route(`**${base}/conversations`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    if (posts === 2 && options.rejectSecond)
      return route.fulfill({
        status: 503,
        json: { message: "SYNTHETIC_SECOND_SAVE_FAILED" },
      });
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (posts === 1) {
      enter();
      await held;
    }
    await route.fulfill({ response });
  });
  const prompt = page.locator("#prompt");
  const ask = page.getByRole("button", { name: "提案を依頼", exact: true });
  const history = async () =>
    (await (await page.request.get(`${base}/conversations`)).json()) as {
      id: string;
      text: string;
      sequence: number;
    }[];
  const abandonFirst = async () => {
    await prompt.fill(a);
    await ask.click();
    await entered;
    expect((await history()).map((m) => m.text)).toEqual([a.trim()]);
    await chat(page, false);
    await accent.fill("#334455");
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(accent).toHaveValue(originalAccent);
    await chat(page, true);
    await prompt.fill(b);
  };
  const finishOld = async (count: number) => {
    release();
    await expect.poll(() => proposals).toBe(count);
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
  };
  const sendSecond = async () => {
    await ask.click();
    const second = page.getByRole("button", { name: "候補 2", exact: true });
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(prompt).toHaveValue(b);
  };
  const check = async (texts: string[]) => {
    const messages = await history();
    expect(messages.map((m) => m.text)).toEqual(
      texts.map((text) => text.trim()),
    );
    expect(messages.map((m) => m.sequence)).toEqual(texts.map((_, i) => i + 1));
    expect(new Set(messages.map((m) => m.id)).size).toBe(texts.length);
    expect(posts).toBe(2);
    expect(errors).toEqual([]);
    const server = (await (await page.request.get(`${base}/foundation`)).json())
      .current;
    expect(server.revision).toBe(1);
    expect(server.design.accent).toBe(originalAccent);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
  };
  return {
    p,
    base,
    key,
    a,
    b,
    prompt,
    ask,
    history,
    abandonFirst,
    finishOld,
    sendSecond,
    release,
    check,
  };
}

for (const width of [1440, 390])
  for (const lateFirst of [false, true])
    test(`saved prompt permits exit with ${lateFirst ? "B then A" : "A then B"} receipts at ${width}`, async ({
      page,
    }) => {
      const f = await prepared(page, width);
      try {
        await f.abandonFirst();
        if (!lateFirst) await f.finishOld(1);
        await f.sendSecond();
        await f.finishOld(2);
        await expect(f.prompt).toHaveValue(f.b);
        expect(
          await page.evaluate((key) => localStorage.getItem(key), f.key),
        ).toBe("");
        await exit(page, false);
        await f.check([f.a, f.b]);
      } finally {
        f.release();
      }
    });

test("failed newer save protects its input and a late older success still permits leaving the acknowledged text", async ({
  page,
}) => {
  const f = await prepared(page, 1440, { rejectSecond: true });
  try {
    await f.abandonFirst();
    const failed = page.waitForResponse(
      (r) => r.url().endsWith(`${f.base}/conversations`) && r.status() === 503,
    );
    await f.ask.click();
    await failed;
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "SYNTHETIC_SECOND_SAVE_FAILED" }),
    ).toBeVisible();
    await f.finishOld(1);
    await exit(page, true);
    await expect(f.prompt).toHaveValue(f.b);
    await f.prompt.fill(f.a);
    await exit(page, false);
    await f.check([f.a]);
  } finally {
    f.release();
  }
});

test("a new unsent edit remains protected after both saved receipts arrive", async ({
  page,
}) => {
  const f = await prepared(page);
  try {
    await f.abandonFirst();
    await f.sendSecond();
    const unsent = "UNSENT edit C";
    await f.prompt.fill(unsent);
    await f.finishOld(2);
    await exit(page, true);
    await expect(f.prompt).toHaveValue(unsent);
    await f.prompt.fill(f.b);
    await exit(page, false);
    await f.check([f.a, f.b]);
  } finally {
    f.release();
  }
});

test("acknowledging repeated text does not merge distinct saved messages", async ({
  page,
}) => {
  const f = await prepared(page, 1440, { sameText: true });
  try {
    await f.abandonFirst();
    await f.sendSecond();
    await f.finishOld(2);
    await expect(f.prompt).toHaveValue(f.b);
    await exit(page, false);
    await f.check([f.a, f.b]);
  } finally {
    f.release();
  }
});

test("acknowledgements stay in their Project and revisiting preserves history without persisting failed drafts", async ({
  page,
}) => {
  const b = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Separate prompt Project" }, useTaste: false },
    })
  ).json();
  const f = await prepared(page, 390);
  try {
    await f.abandonFirst();
    await f.sendSecond();
    await f.finishOld(2);
    await chat(page, false);
    await menu(page);
    await page.getByLabel("プロジェクト切り替え").selectOption(b.id);
    await menu(page);
    await page.getByRole("link", { name: "Foundation", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${b.id}/foundation$`));
    await chat(page, true);
    await denyPromptWrite(page, `tasteprint.${b.id}.prompt`);
    await page.locator("#prompt").fill(f.b);
    await exit(page, true);
    await expect(page.locator("#prompt")).toHaveValue(f.b);
    expect(
      await (
        await page.request.get(`/api/projects/${b.id}/conversations`)
      ).json(),
    ).toEqual([]);
    await page.locator("#prompt").fill("");
    await exit(page, false);
    await menu(page);
    await page.getByLabel("プロジェクト切り替え").selectOption(f.p.id);
    await menu(page);
    await page.getByRole("link", { name: "Foundation", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${f.p.id}/foundation$`));
    await chat(page, true);
    await expect(page.locator("#prompt")).toHaveValue("");
    await expect(page.locator(".conversation-content > p")).toContainText([
      f.a,
      f.b,
    ]);
    await page.locator("#prompt").fill("UNSENT after revisit");
    await exit(page, true);
    await expect(page.locator("#prompt")).toHaveValue("UNSENT after revisit");
    await f.check([f.a, f.b]);
  } finally {
    f.release();
  }
});
