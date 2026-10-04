import { test, expect } from "@playwright/test";
const a = {
  id: "new-policy",
  target: "list",
  text: "一覧の原則",
  reason: "一覧の理由",
  sources: ["一覧の出典"],
  locked: false,
};
const b = {
  ...a,
  target: "form",
  text: "フォームの原則",
  reason: "フォームの理由",
};
for (const width of [1440, 390])
  test(`Duplicate policy input is rejected and retained at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const p = await (
      await page.request.post("/api/projects", {
        data: { brief: { name: "Invalid policy input" }, useTaste: false },
      })
    ).json();
    const base = `/api/projects/${p.id}`;
    const current = (await (await page.request.get(base)).json()).current;
    const key = `tasteprint.${p.id}.overview`;
    const draft = {
      baseRevision: 1,
      brief: { ...current.snapshot.brief, purpose: "未保存の概要を保持" },
      policies: [a, b],
    };
    await page.addInitScript(
      ({ key, draft }) => {
        localStorage.setItem("tasteprint.projects.migrated.v1", "complete");
        localStorage.setItem(key, JSON.stringify(draft));
      },
      { key, draft },
    );
    await page.goto(`/projects/${p.id}/overview`);
    await expect(page.locator(".principle-fields")).toHaveCount(2);
    let statuses: number[] = [];
    page.on("response", (r) => {
      if (r.url().endsWith(base) && r.request().method() === "POST")
        statuses.push(r.status());
    });
    await page
      .getByRole("button", { name: "概要・方針を保存", exact: true })
      .click();
    await expect(
      page.locator(".editor-actions").getByRole("alert"),
    ).toContainText("入力内容を確認してください");
    expect(statuses).toEqual([400]);
    await expect(page.getByLabel("用途", { exact: true })).toHaveValue(
      draft.brief.purpose,
    );
    await expect(
      page
        .locator(".principle-fields")
        .nth(0)
        .getByLabel("原則", { exact: true }),
    ).toHaveValue(a.text);
    await expect(
      page
        .locator(".principle-fields")
        .nth(1)
        .getByLabel("原則", { exact: true }),
    ).toHaveValue(b.text);
    expect(
      JSON.parse(await page.evaluate((key) => localStorage.getItem(key)!, key)),
    ).toEqual(draft);
    const after = (await (await page.request.get(base)).json()).current;
    expect(after.revision).toBe(1);
    expect(after.snapshot.policies).toEqual([]);
    await page.locator(".editor-actions").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/policy-duplicate-${width}.png`,
    });
  });
test("Distinct policy IDs remain independent through edit, delete, save and explicit promotion", async ({
  page,
}) => {
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Distinct policy identities" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const initial = (await (await page.request.get(base)).json()).current;
  const other = { ...b, id: "another-policy" };
  expect(
    (
      await page.request.post(base, {
        data: {
          baseRevision: 1,
          brief: initial.snapshot.brief,
          policies: [a, other],
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/projects/${p.id}/overview`);
  const fields = page.locator(".principle-fields");
  await expect(fields).toHaveCount(2);
  await fields
    .nth(0)
    .getByLabel("原則", { exact: true })
    .fill("一覧だけを編集する");
  await expect(fields.nth(1).getByLabel("原則", { exact: true })).toHaveValue(
    other.text,
  );
  await page
    .getByRole("button", { name: "概要・方針を保存", exact: true })
    .click();
  await expect(page.locator(".editor-actions")).toContainText("設計 r3");
  await fields
    .nth(0)
    .getByRole("button", { name: "原則を削除", exact: true })
    .click();
  await expect(fields).toHaveCount(1);
  await expect(fields.getByLabel("原則", { exact: true })).toHaveValue(
    other.text,
  );
  await page
    .getByRole("button", { name: "概要・方針を保存", exact: true })
    .click();
  await expect(page.locator(".editor-actions")).toContainText("設計 r4");
  await page.locator(".promotion-choice input").check();
  await page
    .getByLabel("選択した原則・理由・出典を共通へ追加することを確認しました", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "選択した判断を共通に追加", exact: true })
    .click();
  await expect(page.locator(".promotion-choice input")).not.toBeChecked();
  const shared = (await (await page.request.get("/api/profile")).json())
    .current;
  expect(shared.snapshot.principles).toContainEqual(other);
  expect(
    (await (await page.request.get(base)).json()).current.snapshot.policies,
  ).toEqual([other]);
});
