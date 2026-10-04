import { test, expect, type Page } from "@playwright/test";
import type { SavedReference } from "../src/domain/reference";
type Scope = { base: string; path: string; id: string; profile: boolean };
const createdReferences: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of createdReferences.splice(0)) {
    const data = await (await request.get(base)).json();
    const ref = data.references.find((r: SavedReference) => r.id === id);
    if (ref) {
      const deleted = await request.delete(`${base}/${id}`, {
        data: { version: ref.version },
      });
      expect(deleted.ok()).toBe(true);
    }
  }
});
const input = {
  name: "Reference draft conflict",
  url: "",
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
};
async function setup(page: Page, profile: boolean) {
  let scope: Scope = {
    base: "/api/profile/references",
    path: "/profile",
    id: "profile",
    profile,
  };
  if (!profile) {
    const p = await (
      await page.request.post("/api/projects", {
        data: {
          brief: { name: "Reference draft concurrency" },
          useTaste: false,
        },
      })
    ).json();
    scope = {
      base: `/api/projects/${p.id}/references`,
      path: `/projects/${p.id}/inspiration`,
      id: p.id,
      profile,
    };
  }
  const response = await page.request.post(scope.base, {
    data: { ...input, name: `${input.name} ${crypto.randomUUID()}` },
  });
  expect(response.ok()).toBe(true);
  const ref: SavedReference = await response.json();
  createdReferences.push({ base: scope.base, id: ref.id });
  const key = `tasteprint.${scope.id}.reference.${ref.id}`;
  const externalName = `External updated reference ${ref.id}`;
  const card = page.getByRole("article").filter({
    has: page
      .getByRole("heading", { name: ref.name, exact: true })
      .or(page.getByRole("heading", { name: externalName, exact: true })),
  });
  return {
    scope,
    externalName,
    ref,
    key,
    card,
    notes: card.getByRole("textbox", { name: "好きな点", exact: true }),
    avoid: card.getByRole("textbox", { name: "避けたい点", exact: true }),
    save: card.getByRole("button", { name: "観点・メモを保存", exact: true }),
    reset: card.getByRole("button", {
      name: "最新の保存内容を読み込む",
      exact: true,
    }),
    read: async (): Promise<SavedReference> =>
      (await (await page.request.get(scope.base)).json()).references.find(
        (r: SavedReference) => r.id === ref.id,
      ),
    external: async () => {
      const response = await page.request.patch(`${scope.base}/${ref.id}`, {
        data: {
          ...input,
          version: ref.version,
          name: externalName,
          dislikes: "外部で保存した避けたい点",
        },
      });
      expect(response.ok()).toBe(true);
      return response.json();
    },
    visit: async () => {
      await page.goto(scope.path);
      if (profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      await expect(card).toBeVisible();
    },
  };
}
for (const profile of [true, false]) {
  const label = profile ? "Profile" : "project";
  test(`${label} dirty Reference preserves its base across external polling and reload until explicit recovery`, async ({
    page,
  }) => {
    const f = await setup(page, profile);
    let patches = 0;
    page.on("request", (r) => {
      if (
        r.method() === "PATCH" &&
        new URL(r.url()).pathname === `${f.scope.base}/${f.ref.id}`
      )
        patches++;
    });
    await f.visit();
    await f.notes.fill("未保存の自分のメモ");
    await f.external();
    await expect(f.card.getByRole("heading")).toHaveText(f.externalName, {
      timeout: 10000,
    });
    await expect(f.notes).toHaveValue("未保存の自分のメモ");
    await expect(f.save).toBeDisabled();
    await expect(f.card.getByRole("alert")).toContainText("別の操作で更新");
    expect(patches).toBe(0);
    await f.visit();
    await expect(f.notes).toHaveValue("未保存の自分のメモ");
    await expect(f.save).toBeDisabled();
    expect((await f.read()).version).toBe(2);
    expect((await f.read()).dislikes).toBe("外部で保存した避けたい点");
    if (profile)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        await f.reset.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/reference-stale-${width}.png`,
        });
      }
    await f.reset.click();
    await expect(f.notes).toHaveValue("");
    await expect(f.avoid).toHaveValue("外部で保存した避けたい点");
    await expect(f.reset).toHaveCount(0);
    await f.notes.fill("新しい基準で入力したメモ");
    await f.save.click();
    await expect(f.save).toBeDisabled();
    await expect(f.notes).toBeEditable();
    expect(patches).toBe(1);
    expect(await f.read()).toMatchObject({
      version: 3,
      name: f.externalName,
      likes: "新しい基準で入力したメモ",
      dislikes: "外部で保存した避けたい点",
    });
  });
  test(`${label} untouched Reference follows an external update and can save using that version`, async ({
    page,
  }) => {
    const f = await setup(page, profile);
    await f.visit();
    await f.external();
    await expect(f.avoid).toHaveValue("外部で保存した避けたい点", {
      timeout: 10000,
    });
    await expect(f.reset).toHaveCount(0);
    await f.notes.fill("外部更新を確認したメモ");
    await f.save.click();
    await expect(f.save).toBeDisabled();
    await expect(f.notes).toBeEditable();
    expect(await f.read()).toMatchObject({
      version: 3,
      name: f.externalName,
      likes: "外部更新を確認したメモ",
      dislikes: "外部で保存した避けたい点",
    });
  });
  for (const legacy of ["version", "unknown"] as const)
    test(`${label} legacy ${legacy} Reference draft retains notes without silently assigning the latest version`, async ({
      page,
    }) => {
      const f = await setup(page, profile);
      await f.external();
      await page.addInitScript(
        ({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)),
        {
          key: f.key,
          draft: {
            ...(legacy === "version" ? f.ref : input),
            likes: "旧形式の未保存メモ",
          },
        },
      );
      await f.visit();
      await expect(f.notes).toHaveValue("旧形式の未保存メモ");
      await expect(f.save).toBeDisabled();
      await expect(f.card.getByRole("alert")).toContainText(
        legacy === "version" ? "別の操作で更新" : "基準版を確認できません",
      );
      expect(await f.read()).toMatchObject({
        version: 2,
        dislikes: "外部で保存した避けたい点",
      });
      await f.reset.click();
      await expect(f.avoid).toHaveValue("外部で保存した避けたい点");
      await expect(f.notes).toHaveValue("");
      await expect(f.reset).toHaveCount(0);
    });
  test(`${label} server 409 before polling preserves the original draft and base then permits explicit recovery`, async ({
    page,
  }) => {
    const f = await setup(page, profile);
    await f.visit();
    const old = await (await page.request.get(f.scope.base)).json();
    await page.route(`**${f.scope.base}`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: old })
        : route.continue(),
    );
    await f.notes.fill("競合した未保存メモ");
    await f.external();
    const conflict = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        new URL(r.url()).pathname === `${f.scope.base}/${f.ref.id}` &&
        r.status() === 409,
    );
    await f.save.click();
    await conflict;
    await expect(f.notes).toHaveValue("競合した未保存メモ");
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).baseVersion,
        f.key,
      ),
    ).toBe(1);
    expect((await f.read()).version).toBe(2);
    await page.unroute(`**${f.scope.base}`);
    await expect(f.reset).toBeVisible({ timeout: 10000 });
    await f.reset.click();
    await expect(f.card.getByRole("alert")).toHaveCount(0);
    await f.notes.fill("競合から回復したメモ");
    await f.save.click();
    await expect(f.save).toBeDisabled();
    await expect(f.notes).toBeEditable();
    expect(await f.read()).toMatchObject({
      version: 3,
      name: f.externalName,
      dislikes: "外部で保存した避けたい点",
      likes: "競合から回復したメモ",
    });
  });
}
test("clean legacy Reference draft acquires a safe base while empty selections and failed saves survive reload", async ({
  page,
}) => {
  const f = await setup(page, true);
  await page.addInitScript(
    ({ key, draft }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(draft));
    },
    { key: f.key, draft: { ...input, name: f.ref.name } },
  );
  await f.visit();
  await expect(f.reset).toHaveCount(0);
  const typography = f.card.getByRole("combobox", {
    name: `${f.ref.name} Typography`,
    exact: true,
  });
  await typography.selectOption("none");
  await f.notes.fill("選択なしでも保持するメモ");
  await f.visit();
  await expect(typography).toHaveValue("none");
  await expect(f.notes).toHaveValue("選択なしでも保持するメモ");
  await expect(f.save).toBeDisabled();
  await expect(f.reset).toHaveCount(0);
  await typography.selectOption("reference");
  const endpoint = `**${f.scope.base}/${f.ref.id}`;
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 500, json: { message: "基準版を保持して再試行" } }),
  );
  await f.save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "基準版を保持して再試行" }),
  ).toBeVisible();
  await expect(f.save).toBeEnabled();
  await f.visit();
  await expect(f.notes).toHaveValue("選択なしでも保持するメモ");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).baseVersion,
      f.key,
    ),
  ).toBe(1);
  await page.unroute(endpoint);
  await f.save.click();
  await expect(f.save).toBeDisabled();
  await expect(f.notes).toBeEditable();
  expect((await f.read()).version).toBe(2);
  await f.notes.fill("保存後の次のメモ");
  await f.save.click();
  await expect(f.save).toBeDisabled();
  await expect(f.notes).toBeEditable();
  expect(await f.read()).toMatchObject({
    version: 3,
    likes: "保存後の次のメモ",
  });
});
