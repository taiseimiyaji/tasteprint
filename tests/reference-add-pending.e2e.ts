import { test, expect, type Page } from "@playwright/test";
import type { SavedReference } from "../src/domain/reference";
const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const ref = (await (await request.get(base)).json()).references.find(
      (ref: SavedReference) => ref.id === id,
    );
    if (ref)
      expect(
        (
          await request.delete(`${base}/${id}`, {
            data: { version: ref.version },
          })
        ).ok(),
      ).toBe(true);
  }
});
function gate() {
  let release!: () => void, enter!: () => void;
  return {
    held: new Promise<void>((resolve) => (release = resolve)),
    entered: new Promise<void>((resolve) => (enter = resolve)),
    release: () => release(),
    enter: () => enter(),
  };
}
async function setup(page: Page, profile: boolean) {
  let base = "/api/profile/references",
    path = "/profile";
  if (!profile) {
    const project = await (
      await page.request.post("/api/projects", {
        data: { brief: { name: "Reference URL pending" }, useTaste: false },
      })
    ).json();
    base = `/api/projects/${project.id}/references`;
    path = `/projects/${project.id}/inspiration`;
  }
  const read = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === base &&
      response.request().method() === "GET",
  );
  await page.goto(path);
  if (profile)
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
  await (await read).finished();
  const url = page.getByRole("textbox", { name: "Reference URL", exact: true });
  await expect(url).toBeEnabled();
  return {
    base,
    url,
    add: page.getByRole("button", { name: "参考を追加", exact: true }),
  };
}
async function holdAdds(page: Page, base: string) {
  const waits = [gate(), gate()];
  const bodies: { url: string }[] = [];
  let failFirst = false;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const index = bodies.length;
    bodies.push(route.request().postDataJSON());
    const hold = waits[index];
    if (failFirst && index === 0) {
      hold.enter();
      await hold.held;
      return route.fulfill({
        status: 400,
        json: { message: "ADD_REFERENCE_FAILURE" },
      });
    }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    created.push({ base, id: (await response.json()).id });
    hold.enter();
    await hold.held;
    await route.fulfill({ response });
  });
  return { waits, bodies, fail: () => (failFirst = true) };
}
for (const profile of [false, true]) {
  const label = profile ? "Profile" : "Project";
  test(`${label} new URL is protected through an accepted add response and ready for the next input`, async ({
    page,
  }) => {
    const f = await setup(page, profile),
      pending = await holdAdds(page, f.base);
    const a = `https://example.com/${crypto.randomUUID()}`,
      b = `https://example.org/${crypto.randomUUID()}`;
    try {
      await f.url.fill(a);
      await f.add.click();
      await pending.waits[0].entered;
      await expect(f.url).toBeDisabled();
      await expect(f.url).toHaveValue(a);
      await expect(f.add).toBeDisabled();
      await page.keyboard.type(b);
      await expect(f.url).toHaveValue(a);
      expect(pending.bodies).toHaveLength(1);
      expect(pending.bodies[0].url).toBe(a);
      pending.waits[0].release();
      await expect(f.add).toBeEnabled();
      await expect(f.url).toBeEnabled();
      await expect(f.url).toHaveValue("");
      await f.url.fill(b);
      await expect(f.url).toHaveValue(b);
      expect(pending.bodies).toHaveLength(1);
      const refs = (await (await page.request.get(f.base)).json())
        .references as SavedReference[];
      expect(refs.some((ref) => ref.url === a)).toBe(true);
      expect(refs.some((ref) => ref.url === b)).toBe(false);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    } finally {
      pending.waits.forEach((wait) => wait.release());
    }
  });
  test(`${label} rejected add retains its URL, permits editing and protects an explicit retry`, async ({
    page,
  }) => {
    const f = await setup(page, profile),
      pending = await holdAdds(page, f.base);
    pending.fail();
    const a = `https://example.com/${crypto.randomUUID()}`,
      b = `https://example.org/${crypto.randomUUID()}`;
    try {
      await f.url.fill(a);
      await f.add.click();
      await pending.waits[0].entered;
      await expect(f.url).toBeDisabled();
      await expect(f.url).toHaveValue(a);
      pending.waits[0].release();
      await expect(
        page.getByRole("alert").filter({ hasText: "ADD_REFERENCE_FAILURE" }),
      ).toBeVisible();
      await expect(f.url).toBeEnabled();
      await expect(f.url).toHaveValue(a);
      expect(
        (await (await page.request.get(f.base)).json()).references.some(
          (ref: SavedReference) => ref.url === a,
        ),
      ).toBe(false);
      await f.url.fill(b);
      await f.add.click();
      await pending.waits[1].entered;
      await expect(f.url).toBeDisabled();
      await expect(f.url).toHaveValue(b);
      expect(pending.bodies.map((body) => body.url)).toEqual([a, b]);
      pending.waits[1].release();
      await expect(f.url).toBeEnabled();
      await expect(f.url).toHaveValue("");
      expect(
        (await (await page.request.get(f.base)).json()).references.some(
          (ref: SavedReference) => ref.url === b,
        ),
      ).toBe(true);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    } finally {
      pending.waits.forEach((wait) => wait.release());
    }
  });
  test(`${label} GET-only recovery leaves the next URL editable and never submits it`, async ({
    page,
  }) => {
    const f = await setup(page, profile),
      wait = gate();
    let reads = 0,
      posts = 0;
    await page.route(`**${f.base}`, async (route) => {
      if (route.request().method() !== "GET") {
        posts++;
        return route.continue();
      }
      reads++;
      if (reads === 1)
        return route.fulfill({
          status: 503,
          json: { message: "REFERENCE_GET_FAILURE" },
        });
      wait.enter();
      await wait.held;
      await route.continue();
    });
    try {
      const next = `https://example.com/${crypto.randomUUID()}`;
      await f.url.fill(next);
      await page.clock.setFixedTime(
        (await page.evaluate(() => Date.now())) + 35000,
      );
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "参考一覧の読み込みに失敗" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "一覧を再取得", exact: true })
        .click();
      await wait.entered;
      await expect(f.url).toBeEnabled();
      const edited = `${next}/edited`;
      await f.url.fill(edited);
      const response = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === f.base &&
          response.request().method() === "GET",
      );
      wait.release();
      await (await response).finished();
      await expect(
        page.getByRole("alert").filter({ hasText: "参考一覧の読み込みに失敗" }),
      ).toHaveCount(0);
      await expect(f.url).toHaveValue(edited);
      expect(posts).toBe(0);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    } finally {
      wait.release();
    }
  });
}
