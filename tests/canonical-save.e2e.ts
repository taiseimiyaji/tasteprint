import { test, expect, type Page } from "@playwright/test";
const principle = {
  id: "normalized-principle",
  target: "list",
  text: "  Canonical principle  ",
  reason: "  Keep reason whitespace  ",
  sources: ["  Keep source whitespace  "],
  locked: false,
  draftMetadata: "only in draft",
};
async function store(page: Page, key: string, draft: unknown) {
  await page.addInitScript(
    ({ key, draft }) => {
      localStorage.setItem("tasteprint.projects.migrated.v1", "complete");
      localStorage.setItem(key, JSON.stringify(draft));
    },
    { key, draft },
  );
}
async function storage(page: Page, key: string) {
  return JSON.parse(
    await page.evaluate((key) => localStorage.getItem(key)!, key),
  );
}
for (const width of [1440, 390]) {
  test(`Overview accepts canonical saved content at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const p = await (
      await page.request.post("/api/projects", {
        data: { brief: { name: "Canonical save" }, useTaste: false },
      })
    ).json();
    const base = `/api/projects/${p.id}`;
    const current = (await (await page.request.get(base)).json()).current;
    const key = `tasteprint.${p.id}.overview`;
    const draft = {
      baseRevision: 1,
      brief: {
        ...current.snapshot.brief,
        name: "  Canonical name  ",
        purpose: "  Keep purpose whitespace  ",
        draftMetadata: "only in draft",
      },
      policies: [principle],
    };
    await store(page, key, draft);
    let followFailure = false,
      posts = 0;
    await page.route(`**${base}`, async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        const response = await route.fetch();
        followFailure = width === 390;
        return route.fulfill({ response });
      }
      if (followFailure)
        return route.fulfill({
          status: 503,
          json: { message: "Mock overview GET failure" },
        });
      await route.continue();
    });
    await page.goto(`/projects/${p.id}/overview`);
    const reply = page.waitForResponse(
      (r) => r.url().endsWith(base) && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "概要・方針を保存", exact: true })
      .click();
    const response = await reply;
    expect(response.status()).toBe(200);
    const saved = await response.json();
    await expect(page.locator(".editor-actions")).toContainText("保存済み");
    await expect(page.locator(".editor-actions")).toContainText("設計 r2");
    await expect(page.locator(".editor-actions")).toContainText(
      "概要・方針を保存しました",
    );
    await expect(
      page.getByRole("button", { name: "概要・方針を保存", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("プロジェクト名", { exact: true }),
    ).toHaveValue("Canonical name");
    await expect(
      page.locator(".principle-fields").getByLabel("原則", { exact: true }),
    ).toHaveValue("Canonical principle");
    expect(saved.snapshot.brief.purpose).toBe(draft.brief.purpose);
    expect(saved.snapshot.policies[0].reason).toBe(principle.reason);
    expect(saved.snapshot.policies[0].sources).toEqual(principle.sources);
    await expect
      .poll(() => storage(page, key))
      .toEqual({
        baseRevision: saved.revision,
        brief: saved.snapshot.brief,
        policies: saved.snapshot.policies,
      });
    if (followFailure)
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Mock overview GET failure" }),
      ).toBeVisible();
    expect(posts).toBe(1);
    expect((await (await page.request.get(base)).json()).current).toEqual(
      saved,
    );
    await page.locator(".editor-actions").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/canonical-overview-${width}.png`,
    });
  });
}
test("Overview rejected normalization keeps raw draft and original revision", async ({
  page,
}) => {
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Rejected save" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const current = (await (await page.request.get(base)).json()).current;
  const key = `tasteprint.${p.id}.overview`;
  const draft = {
    baseRevision: 1,
    brief: { ...current.snapshot.brief, name: "  Keep raw name  " },
    policies: [{ ...principle, text: "   " }],
  };
  await store(page, key, draft);
  await page.goto(`/projects/${p.id}/overview`);
  const response = page.waitForResponse(
    (r) => r.url().endsWith(base) && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "概要・方針を保存", exact: true })
    .click();
  expect((await response).status()).toBe(400);
  await expect(
    page.locator(".editor-actions").getByRole("alert"),
  ).toBeVisible();
  await expect(page.getByLabel("プロジェクト名", { exact: true })).toHaveValue(
    draft.brief.name,
  );
  await expect(
    page.locator(".principle-fields").getByLabel("原則", { exact: true }),
  ).toHaveValue("   ");
  expect(await storage(page, key)).toEqual(draft);
  expect((await (await page.request.get(base)).json()).current).toEqual(
    current,
  );
});

let referenceId = "";
test.afterEach(async ({ request }) => {
  if (!referenceId) return;
  const id = referenceId;
  referenceId = "";
  const current = (
    await (await request.get("/api/profile/references")).json()
  ).references.find((r: { id: string }) => r.id === id);
  if (current)
    expect(
      (
        await request.delete(`/api/profile/references/${id}`, {
          data: { version: current.version },
        })
      ).ok(),
    ).toBe(true);
});
async function referenceDraft(page: Page) {
  const reference = await (
    await page.request.post("/api/profile/references", {
      data: {
        name: "Restored canonical reference",
        url: "https://canonical.example",
        selections: [{ aspect: "Typography", intent: "reference" }],
        likes: "",
        dislikes: "",
      },
    })
  ).json();
  referenceId = reference.id;
  const key = `tasteprint.profile.reference.${reference.id}`;
  const draft = {
    ...reference,
    name: "  Restored canonical reference  ",
    likes: "  Keep note whitespace  ",
    baseVersion: reference.version,
    selections: reference.selections.map((s: object) => ({
      ...s,
      draftMetadata: "only in draft",
    })),
  };
  await store(page, key, draft);
  return { reference, key, draft };
}
for (const width of [1440, 390]) {
  test(`Reference accepts canonical PATCH and stays editable at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const { reference, key, draft } = await referenceDraft(page);
    const base = `/api/profile/references/${reference.id}`;
    let followFailure = false,
      patches = 0;
    await page.route("**/api/profile/references", async (route) => {
      if (followFailure && route.request().method() === "GET")
        return route.fulfill({
          status: 503,
          json: { message: "Mock reference GET failure" },
        });
      await route.continue();
    });
    await page.route(`**${base}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      patches++;
      const response = await route.fetch();
      followFailure = width === 390;
      await route.fulfill({ response });
    });
    await page.goto("/profile");
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
    const card = page.locator(".reference-card").filter({
      has: page.getByRole("heading", { name: reference.name, exact: true }),
    });
    const reply = page.waitForResponse(
      (r) => r.url().endsWith(base) && r.request().method() === "PATCH",
    );
    await card
      .getByRole("button", { name: "観点・メモを保存", exact: true })
      .click();
    const response = await reply;
    expect(response.status()).toBe(200);
    const saved = await response.json();
    await expect(
      card.getByRole("button", { name: "観点・メモを保存", exact: true }),
    ).toBeDisabled();
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "URLを取得", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() => storage(page, key))
      .toEqual({
        name: saved.name,
        url: saved.url,
        selections: saved.selections,
        likes: saved.likes,
        dislikes: saved.dislikes,
        baseVersion: saved.version,
      });
    expect(saved.name).toBe(reference.name);
    expect(saved.likes).toBe(draft.likes);
    await card
      .getByRole("textbox", { name: "好きな点", exact: true })
      .fill("Next note");
    await expect(
      card.getByRole("button", { name: "観点・メモを保存", exact: true }),
    ).toBeEnabled();
    if (followFailure)
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "Mock reference GET failure" }),
      ).toBeVisible();
    expect(patches).toBe(1);
    if (width === 1440) {
      const nextReply = page.waitForResponse(
        (r) => r.url().endsWith(base) && r.request().method() === "PATCH",
      );
      await card
        .getByRole("button", { name: "観点・メモを保存", exact: true })
        .click();
      const nextResponse = await nextReply;
      expect(nextResponse.status()).toBe(200);
      expect(nextResponse.request().postDataJSON().version).toBe(saved.version);
      const nextSaved = await nextResponse.json();
      expect(nextSaved.version).toBe(saved.version + 1);
      expect(nextSaved.name).toBe(reference.name);
      expect(nextSaved.likes).toBe("Next note");
      await expect
        .poll(async () => (await storage(page, key)).baseVersion)
        .toBe(nextSaved.version);
      const stored = (
        await (await page.request.get("/api/profile/references")).json()
      ).references.find((r: { id: string }) => r.id === reference.id);
      expect(stored).toEqual(nextSaved);
      expect(patches).toBe(2);
    }
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/canonical-reference-${width}.png`,
    });
  });
}
test("Reference failed PATCH preserves restored raw input and its base", async ({
  page,
}) => {
  const { reference, key, draft } = await referenceDraft(page);
  await page.route(`**/api/profile/references/${reference.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          json: { message: "Mock PATCH rejection" },
        })
      : route.continue(),
  );
  await page.goto("/profile");
  await page.getByRole("button", { name: "参考を集める", exact: true }).click();
  const card = page.locator(".reference-card").filter({
    has: page.getByRole("heading", { name: reference.name, exact: true }),
  });
  await card
    .getByRole("button", { name: "観点・メモを保存", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Mock PATCH rejection" }),
  ).toBeVisible();
  await expect(
    card.getByRole("textbox", { name: "好きな点", exact: true }),
  ).toHaveValue(draft.likes);
  expect((await storage(page, key)).name).toBe(draft.name);
  expect((await storage(page, key)).baseVersion).toBe(reference.version);
  const saved = (
    await (await page.request.get("/api/profile/references")).json()
  ).references.find((r: { id: string }) => r.id === reference.id);
  expect(saved).toEqual(reference);
});
