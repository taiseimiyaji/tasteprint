import { test, expect, type Page } from "@playwright/test";
const confirmation = (page: Page) =>
  page.getByLabel(
    "選択した原則・理由・出典を共通へ追加することを確認しました",
    { exact: true },
  );
const add = (page: Page) =>
  page.getByRole("button", { name: "選択した判断を共通に追加", exact: true });
const policy = {
  id: "confirmation-own",
  target: "list",
  text: "一覧は行で比較する",
  reason: "比較しやすくする",
  sources: ["元の出典"],
  locked: false,
};
async function profile(page: Page) {
  return (await (await page.request.get("/api/profile")).json()).current;
}
async function project(page: Page) {
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Promotion confirmation" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const current = (await (await page.request.get(base)).json()).current;
  expect(
    (
      await page.request.post(base, {
        data: {
          baseRevision: 1,
          brief: current.snapshot.brief,
          policies: [policy],
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/projects/${p.id}/overview`);
  await page.locator(".promotion-choice input").check();
  await confirmation(page).check();
  await expect(add(page)).toBeEnabled();
  return { base, id: p.id, brief: current.snapshot.brief };
}
async function background(page: Page) {
  const projectPath = new URL(page.url()).pathname
    .split("/")
    .slice(0, 3)
    .join("/");
  const reads = ["/api/profile", `/api${projectPath}`].map((path) =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path &&
        response.request().method() === "GET",
    ),
  );
  await page.clock.setFixedTime(
    (await page.evaluate(() => Date.now())) + 35000,
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  const responses = await Promise.all(reads);
  await Promise.all(responses.map((response) => response.finished()));
  // Let completed query responses commit to the UI before unchanged-state checks.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const width of [1440, 390])
  test(`Changed Project principle requires a new confirmation at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const before = await profile(page);
    const { base, id, brief } = await project(page);
    let bodies: unknown[] = [];
    await page.route(`**${base}/promote`, async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.continue();
    });
    const replacement = {
      ...policy,
      text: "一覧は大きいカードにする",
      reason: "画像を見せる",
      sources: ["新しい出典"],
    };
    await page
      .getByLabel("プロジェクト名", { exact: true })
      .fill("未保存の概要名");
    expect(
      (
        await page.request.post(base, {
          data: { baseRevision: 2, brief, policies: [replacement] },
        })
      ).ok(),
    ).toBeTruthy();
    await background(page);
    await expect(page.locator(".promotion-choice")).toContainText(
      replacement.text,
    );
    await expect(confirmation(page)).not.toBeChecked();
    await expect(add(page)).toBeDisabled();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "追加の確認をやり直してください" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("プロジェクト名", { exact: true }),
    ).toHaveValue("未保存の概要名");
    expect(bodies).toHaveLength(0);
    expect((await profile(page)).revision).toBe(before.revision);
    await confirmation(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/promotion-stale-${width}.png`,
    });
    await confirmation(page).check();
    await add(page).click();
    await expect(page.locator(".promotion-choice input")).not.toBeChecked();
    expect(bodies).toEqual([
      {
        baseRevision: 3,
        baseProfileRevision: before.revision,
        ids: [policy.id],
      },
    ]);
    expect((await profile(page)).snapshot.principles).toContainEqual(
      replacement,
    );
  });
test("Removed selected principle cannot be confirmed or sent", async ({
  page,
}) => {
  const before = await profile(page);
  const { base, brief } = await project(page);
  let posts = 0;
  await page.route(`**${base}/promote`, async (route) => {
    posts++;
    await route.continue();
  });
  expect(
    (
      await page.request.post(base, {
        data: { baseRevision: 2, brief, policies: [] },
      })
    ).ok(),
  ).toBeTruthy();
  await background(page);
  await expect(page.locator(".promotion-choice")).toHaveCount(0);
  await expect(confirmation(page)).not.toBeChecked();
  await expect(confirmation(page)).toBeDisabled();
  await expect(add(page)).toBeDisabled();
  expect(posts).toBe(0);
  expect((await profile(page)).revision).toBe(before.revision);
});
test("Changed shared Profile requires a new confirmation before replacing the same principle ID", async ({
  page,
}) => {
  const { base } = await project(page);
  const before = await profile(page);
  const shared = {
    ...policy,
    text: "共有側で編集した原則",
    reason: "共有側の理由",
  };
  expect(
    (
      await page.request.post("/api/profile", {
        data: {
          baseProfileRevision: before.revision,
          answers: before.snapshot.answers,
          reasons: before.snapshot.reasons,
          principles: [
            ...before.snapshot.principles.filter(
              (p: { id: string }) => p.id !== policy.id,
            ),
            shared,
          ],
        },
      })
    ).ok(),
  ).toBeTruthy();
  await background(page);
  await expect(confirmation(page)).not.toBeChecked();
  await expect(add(page)).toBeDisabled();
  expect((await profile(page)).snapshot.principles).toContainEqual(shared);
  let body: unknown;
  await page.route(`**${base}/promote`, async (route) => {
    body = route.request().postDataJSON();
    await route.continue();
  });
  await confirmation(page).check();
  await add(page).click();
  await expect(page.locator(".promotion-choice input")).not.toBeChecked();
  expect(body).toEqual({
    baseRevision: 2,
    baseProfileRevision: before.revision + 1,
    ids: [policy.id],
  });
  expect((await profile(page)).snapshot.principles).toContainEqual(policy);
});
for (const target of ["project", "profile", "other-policy", "other-principle"])
  test(`Unrelated ${target} revision changes preserve the confirmed content`, async ({
    page,
  }) => {
    const { base, brief } = await project(page);
    const before = await profile(page);
    if (target === "project" || target === "other-policy")
      expect(
        (
          await page.request.post(base, {
            data: {
              baseRevision: 2,
              brief:
                target === "project"
                  ? { ...brief, purpose: "無関係な概要更新" }
                  : brief,
              policies:
                target === "other-policy"
                  ? [
                      policy,
                      {
                        ...policy,
                        id: "unrelated-own",
                        target: "form",
                        text: "非選択原則",
                      },
                    ]
                  : [policy],
            },
          })
        ).ok(),
      ).toBeTruthy();
    else
      expect(
        (
          await page.request.post("/api/profile", {
            data: {
              baseProfileRevision: before.revision,
              answers: before.snapshot.answers,
              reasons:
                target === "profile"
                  ? {
                      ...before.snapshot.reasons,
                      "density-0": "無関係な理由更新",
                    }
                  : before.snapshot.reasons,
              principles:
                target === "other-principle"
                  ? [
                      ...before.snapshot.principles.filter(
                        (p: { id: string }) => p.id !== "unrelated-shared",
                      ),
                      {
                        ...policy,
                        id: "unrelated-shared",
                        target: "form",
                        text: "無関係な共通原則",
                      },
                    ]
                  : before.snapshot.principles,
            },
          })
        ).ok(),
      ).toBeTruthy();
    await background(page);
    if (target === "project" || target === "other-policy")
      await expect(page.locator(".editor-actions")).toContainText("設計 r3");
    await expect(confirmation(page)).toBeChecked();
    await expect(add(page)).toBeEnabled();
    await expect(
      page
        .locator(".promotion-choice")
        .filter({ hasText: policy.text })
        .locator("input"),
    ).toBeChecked();
    let body: unknown;
    await page.route(`**${base}/promote`, async (route) => {
      body = route.request().postDataJSON();
      await route.continue();
    });
    await add(page).click();
    await expect(
      page
        .locator(".promotion-choice")
        .filter({ hasText: policy.text })
        .locator("input"),
    ).not.toBeChecked();
    expect(body).toEqual({
      baseRevision: target === "project" || target === "other-policy" ? 3 : 2,
      baseProfileRevision:
        target === "profile" || target === "other-principle"
          ? before.revision + 1
          : before.revision,
      ids: [policy.id],
    });
    const after = await profile(page);
    expect(after.snapshot.principles).toContainEqual(policy);
    if (target === "profile")
      expect(after.snapshot.reasons["density-0"]).toBe("無関係な理由更新");
    else if (target === "project")
      expect(
        (await (await page.request.get(base)).json()).current.snapshot.brief
          .purpose,
      ).toBe("無関係な概要更新");
    if (target === "other-policy")
      expect(
        (await (await page.request.get(base)).json()).current.snapshot.policies,
      ).toContainEqual({
        ...policy,
        id: "unrelated-own",
        target: "form",
        text: "非選択原則",
      });
    if (target === "other-principle")
      expect(after.snapshot.principles).toContainEqual({
        ...policy,
        id: "unrelated-shared",
        target: "form",
        text: "無関係な共通原則",
      });
  });
test("Same-revision reads and failed background GET preserve a valid confirmation without a promotion POST", async ({
  page,
}) => {
  const { base } = await project(page);
  await background(page);
  await expect(confirmation(page)).toBeChecked();
  await expect(add(page)).toBeEnabled();
  let posts = 0;
  await page.route(`**${base}/promote`, async (route) => {
    posts++;
    await route.continue();
  });
  await page.route(`**${base}`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 503,
          json: { message: "確認後Project GET失敗" },
        })
      : route.continue(),
  );
  await background(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "確認後Project GET失敗" }),
  ).toBeVisible();
  await expect(confirmation(page)).toBeChecked();
  await expect(add(page)).toBeEnabled();
  expect(posts).toBe(0);
  await page.unroute(`**${base}`);
  await page
    .getByRole("button", { name: "プロジェクトを再取得", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "確認後Project GET失敗" }),
  ).toHaveCount(0);
  await expect(confirmation(page)).toBeChecked();
  expect(posts).toBe(0);
});
test("Pending promotion freezes selection and confirmation and sends the confirmed revisions once", async ({
  page,
}) => {
  const before = await profile(page);
  const { base } = await project(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let reached = false;
  let bodies: unknown[] = [];
  await page.route(`**${base}/promote`, async (route) => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    reached = true;
    await held;
    await route.fulfill({ response });
  });
  await add(page).click();
  await expect.poll(() => reached).toBe(true);
  await expect(page.locator(".promotion-choice input")).toBeDisabled();
  await expect(confirmation(page)).toBeDisabled();
  await expect(add(page)).toBeDisabled();
  await page
    .locator(".promotion-choice input")
    .evaluate((e: HTMLInputElement) => e.click());
  await confirmation(page).evaluate((e: HTMLInputElement) => e.click());
  expect(bodies).toHaveLength(1);
  await expect(page.locator(".promotion-choice input")).toBeChecked();
  release();
  await expect(page.locator(".promotion-choice input")).not.toBeChecked();
  expect(bodies).toEqual([
    { baseRevision: 2, baseProfileRevision: before.revision, ids: [policy.id] },
  ]);
  expect((await profile(page)).snapshot.principles).toContainEqual(policy);
});
test("Removing the same shared principle invalidates the destination confirmation", async ({
  page,
}) => {
  const initial = await profile(page);
  const prior = { ...policy, text: "共有側の既存原則" };
  expect(
    (
      await page.request.post("/api/profile", {
        data: {
          baseProfileRevision: initial.revision,
          answers: initial.snapshot.answers,
          reasons: initial.snapshot.reasons,
          principles: [
            ...initial.snapshot.principles.filter(
              (p: { id: string }) => p.id !== policy.id,
            ),
            prior,
          ],
        },
      })
    ).ok(),
  ).toBeTruthy();
  const { base } = await project(page);
  const before = await profile(page);
  expect(
    (
      await page.request.post("/api/profile", {
        data: {
          baseProfileRevision: before.revision,
          answers: before.snapshot.answers,
          reasons: before.snapshot.reasons,
          principles: before.snapshot.principles.filter(
            (p: { id: string }) => p.id !== policy.id,
          ),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await background(page);
  await expect(confirmation(page)).not.toBeChecked();
  await expect(add(page)).toBeDisabled();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "追加の確認をやり直してください" }),
  ).toBeVisible();
  await confirmation(page).check();
  await add(page).click();
  await expect(page.locator(".promotion-choice input")).not.toBeChecked();
  expect((await profile(page)).snapshot.principles).toContainEqual(policy);
});
test("Unobserved source update keeps the existing 409 protection until content is retrieved and reconfirmed", async ({
  page,
}) => {
  const before = await profile(page);
  const { base, brief } = await project(page);
  const replacement = { ...policy, target: "form", locked: true };
  expect(
    (
      await page.request.post(base, {
        data: { baseRevision: 2, brief, policies: [replacement] },
      })
    ).ok(),
  ).toBeTruthy();
  let bodies: unknown[] = [];
  await page.route(`**${base}/promote`, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.continue();
  });
  await add(page).click();
  await expect(
    page.locator(".editor-actions").getByRole("alert"),
  ).toContainText("プロジェクトが更新されています");
  expect(bodies).toEqual([
    { baseRevision: 2, baseProfileRevision: before.revision, ids: [policy.id] },
  ]);
  expect((await profile(page)).revision).toBe(before.revision);
  await background(page);
  await expect(confirmation(page)).not.toBeChecked();
  await expect(add(page)).toBeDisabled();
  await confirmation(page).check();
  await add(page).click();
  await expect(page.locator(".promotion-choice input")).not.toBeChecked();
  expect(bodies[1]).toEqual({
    baseRevision: 3,
    baseProfileRevision: before.revision,
    ids: [policy.id],
  });
  expect((await profile(page)).snapshot.principles).toContainEqual(replacement);
});
test("Policy array order and JSON property order alone preserve the confirmed source and destination", async ({
  page,
}) => {
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Canonical confirmation" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const initial = (await (await page.request.get(base)).json()).current;
  const other = {
    ...policy,
    id: "confirmation-other",
    target: "form",
    text: "もう一つの原則",
  };
  expect(
    (
      await page.request.post(base, {
        data: {
          baseRevision: 1,
          brief: initial.snapshot.brief,
          policies: [policy, other],
        },
      })
    ).ok(),
  ).toBeTruthy();
  const before = await profile(page);
  expect(
    (
      await page.request.post("/api/profile", {
        data: {
          baseProfileRevision: before.revision,
          answers: before.snapshot.answers,
          reasons: before.snapshot.reasons,
          principles: [
            ...before.snapshot.principles.filter(
              (q: { id: string }) => q.id !== policy.id && q.id !== other.id,
            ),
            policy,
            other,
          ],
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/projects/${p.id}/overview`);
  await expect(page.locator(".promotion-choice input")).toHaveCount(2);
  for (const c of await page.locator(".promotion-choice input").all())
    await c.check();
  await confirmation(page).check();
  const reordered = (q: typeof policy) => ({
    locked: q.locked,
    sources: q.sources,
    reason: q.reason,
    text: q.text,
    target: q.target,
    id: q.id,
  });
  expect(
    (
      await page.request.post(base, {
        data: {
          baseRevision: 2,
          brief: initial.snapshot.brief,
          policies: [reordered(other), reordered(policy)],
        },
      })
    ).ok(),
  ).toBeTruthy();
  const shared = await profile(page);
  expect(
    (
      await page.request.post("/api/profile", {
        data: {
          baseProfileRevision: shared.revision,
          answers: shared.snapshot.answers,
          reasons: shared.snapshot.reasons,
          principles: [...shared.snapshot.principles].reverse().map(reordered),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await background(page);
  await expect(confirmation(page)).toBeChecked();
  await expect(add(page)).toBeEnabled();
  let body: unknown;
  await page.route(`**${base}/promote`, async (route) => {
    body = route.request().postDataJSON();
    await route.continue();
  });
  await add(page).click();
  await expect(
    page.locator(".promotion-choice input").first(),
  ).not.toBeChecked();
  expect(body).toEqual({
    baseRevision: 3,
    baseProfileRevision: shared.revision + 1,
    ids: [policy.id, other.id],
  });
  expect((await profile(page)).snapshot.principles).toEqual(
    expect.arrayContaining([policy, other]),
  );
});
