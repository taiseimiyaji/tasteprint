import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

const draftKey = "tasteprint.profile.draft";
const saveProfile = (page: Page) =>
  page.getByRole("button", { name: "共通の好みを保存", exact: true });
const projects = (page: Page) =>
  page.getByRole("link", { name: "プロジェクト", exact: true });

async function prepare(page: Page, name: string) {
  await page.goto("/profile");
  await page.getByLabel("質問を選ぶ").selectOption("0");
  await page.getByLabel("density-0 理由", { exact: true }).fill(name);
  await page.getByRole("button", { name: "参考を集める", exact: true }).click();
  const png = await sharp({
    create: { width: 480, height: 320, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("画像を選ぶ", { exact: true })
    .setInputFiles({ name, mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "画像を登録", exact: true }).click();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card.getByAltText(`${name}の参考画像`)).toBeVisible();
  await card.getByLabel("送信対象を確認しました").check();
  await card
    .getByRole("button", { name: "Codexで分析する", exact: true })
    .click();
  await expect(
    card.getByText("画像上部の見出し", { exact: true }),
  ).toBeVisible();
  const refs = (
    await (await page.request.get("/api/profile/references")).json()
  ).references;
  const reference = refs.find((r: { name: string }) => r.name === name);
  const current = (await (await page.request.get("/api/profile")).json())
    .current;
  return {
    card,
    reference,
    revision: current.revision,
    principleId: `reference:${reference.id}:0`,
  };
}

async function holdAdoption(
  page: Page,
  id: string,
  outcome: "success" | "failure",
) {
  let releasePost!: () => void, releaseRead!: () => void;
  const postGate = new Promise<void>((resolve) => (releasePost = resolve));
  const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
  let accepted = false,
    posts = 0,
    reads = 0,
    completedReads = 0,
    saves = 0;
  await page.route(`**/api/profile/references/${id}/accept`, async (route) => {
    posts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await postGate;
    accepted = true;
    await route.fulfill({ response });
  });
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() === "POST") saves++;
    await route.continue();
  });
  await page.route("**/api/profile/references", async (route) => {
    if (route.request().method() !== "GET" || !accepted)
      return route.continue();
    reads++;
    // Capture the successful server read before the following Profile save.
    const response = outcome === "success" ? await route.fetch() : undefined;
    await readGate;
    if (response) await route.fulfill({ response });
    else
      await route.fulfill({
        status: 503,
        json: { message: "Fixture reference read failed" },
      });
    completedReads++;
  });
  return {
    releasePost,
    releaseRead,
    posts: () => posts,
    reads: () => reads,
    completedReads: () => completedReads,
    saves: () => saves,
  };
}

async function persistedPrinciple(page: Page, id: string, reason: string) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ key, id, reason }) => {
          const d = JSON.parse(localStorage.getItem(key)!);
          return (
            d.principles.some((p: { id: string }) => p.id === id) &&
            d.reasons["density-0"] === reason
          );
        },
        { key: draftKey, id, reason },
      ),
    )
    .toBe(true);
}

async function removeFixtureReference(page: Page, id: string) {
  // All E2E files share one temporary Profile DB with a 20-Reference limit.
  // Remove only this case's synthetic source, retaining immutable snapshots.
  const references = (
    await (await page.request.get("/api/profile/references")).json()
  ).references;
  const reference = references.find((r: { id: string }) => r.id === id);
  if (reference) {
    const removed = await page.request.delete(`/api/profile/references/${id}`, {
      data: { version: reference.version },
    });
    expect(removed.ok()).toBe(true);
  }
  expect(
    (
      await (await page.request.get("/api/profile/references")).json()
    ).references.some((r: { id: string }) => r.id === id),
  ).toBe(false);
}

for (const outcome of ["success", "failure"] as const) {
  test(`Profile saves an adopted Reference while its supplemental read awaits ${outcome}`, async ({
    page,
  }) => {
    const name = `shared-save-${outcome}.png`;
    const { card, reference, revision, principleId } = await prepare(
      page,
      name,
    );
    const gate = await holdAdoption(page, reference.id, outcome);
    try {
      await card
        .getByRole("button", { name: "設計方針として採用", exact: true })
        .click();
      await expect(saveProfile(page)).toBeDisabled();
      gate.releasePost();
      await expect.poll(gate.reads).toBeGreaterThan(0);
      await persistedPrinciple(page, principleId, name);
      await expect(saveProfile(page)).toBeEnabled();
      await page.getByRole("button", { name: "見比べる", exact: true }).click();
      await page.getByLabel("質問を選ぶ").selectOption("0");
      await page
        .getByLabel("density-0 理由", { exact: true })
        .fill(`next ${name}`);
      await saveProfile(page).click();
      await expect(page.getByText("共通の好みを保存しました")).toBeVisible();
      const current = (await (await page.request.get("/api/profile")).json())
        .current;
      expect(current.revision).toBe(revision + 1);
      expect(
        current.snapshot.principles.some(
          (p: { id: string }) => p.id === principleId,
        ),
      ).toBe(true);
      expect(current.snapshot.reasons["density-0"]).toBe(`next ${name}`);
      const accepted = current.snapshot.references.find(
        (r: { id: string }) => r.id === reference.id,
      );
      expect(accepted.version).toBe(reference.version + 1);
      expect(accepted.accepted).toContain(0);
      await page
        .getByLabel("density-0 理由", { exact: true })
        .fill(`unsaved ${name}`);
      gate.releaseRead();
      await expect.poll(gate.completedReads).toBeGreaterThan(0);
      await page
        .getByRole("button", { name: "参考を集める", exact: true })
        .click();
      if (outcome === "failure") {
        await expect(
          page.getByText("Fixture reference read failed", { exact: false }),
        ).toBeVisible();
        await page.unroute("**/api/profile/references");
        await page
          .getByRole("button", { name: "一覧を再取得", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "一覧を再取得", exact: true }),
        ).toHaveCount(0);
      }
      await expect(
        card.getByRole("button", { name: "採用済み", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "見比べる", exact: true }).click();
      await expect(
        page.getByLabel("density-0 理由", { exact: true }),
      ).toHaveValue(`unsaved ${name}`);
      await persistedPrinciple(page, principleId, `unsaved ${name}`);
      await expect(page.locator(".editor-actions")).toContainText(
        `共通 r${revision + 1}`,
      );
      await page.reload();
      await expect(
        page.getByLabel("density-0 理由", { exact: true }),
      ).toHaveValue(`unsaved ${name}`);
      expect(
        (await (await page.request.get("/api/profile")).json()).current
          .revision,
      ).toBe(revision + 1);
      expect(gate.posts()).toBe(1);
      expect(gate.saves()).toBe(1);
    } finally {
      gate.releasePost();
      gate.releaseRead();
      await removeFixtureReference(page, reference.id);
    }
  });

  test(`390px Profile can leave and revisit an adopted draft before its read ends in ${outcome}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const name = `shared-navigation-${outcome}.png`;
    const { card, reference, revision, principleId } = await prepare(
      page,
      name,
    );
    const gate = await holdAdoption(page, reference.id, outcome);
    try {
      await card
        .getByRole("button", { name: "設計方針として採用", exact: true })
        .click();
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      await projects(page).click();
      await expect(
        page.getByText("更新の完了を待ってから移動します。", { exact: false }),
      ).toBeVisible();
      gate.releasePost();
      await expect.poll(gate.reads).toBeGreaterThan(0);
      await page.waitForURL("**/projects");
      await persistedPrinciple(page, principleId, name);
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      await page.getByRole("link", { name: "自分の好み", exact: true }).click();
      await expect(saveProfile(page)).toBeEnabled();
      await expect(
        page.getByLabel("density-0 理由", { exact: true }),
      ).toHaveValue(name);
      gate.releaseRead();
      await saveProfile(page).click();
      await expect(page.getByText("共通の好みを保存しました")).toBeVisible();
      await expect.poll(gate.completedReads).toBeGreaterThan(0);
      const current = (await (await page.request.get("/api/profile")).json())
        .current;
      expect(current.revision).toBe(revision + 1);
      expect(
        current.snapshot.principles.some(
          (p: { id: string }) => p.id === principleId,
        ),
      ).toBe(true);
      expect(current.snapshot.reasons["density-0"]).toBe(name);
      expect(
        current.snapshot.references.find(
          (r: { id: string }) => r.id === reference.id,
        ).accepted,
      ).toContain(0);
      expect(gate.posts()).toBe(1);
      expect(gate.saves()).toBe(1);
    } finally {
      gate.releasePost();
      gate.releaseRead();
      await removeFixtureReference(page, reference.id);
    }
  });
}

test("An adopted Profile draft that cannot be persisted still cancels navigation without waiting for its helper read", async ({
  page,
}) => {
  const { card, reference } = await prepare(page, "shared-storage-failure.png");
  const gate = await holdAdoption(page, reference.id, "failure");
  await page.evaluate((key) => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key)
        throw new DOMException("Fixture full", "QuotaExceededError");
      return native.call(this, k, v);
    };
  }, draftKey);
  try {
    await card
      .getByRole("button", { name: "設計方針として採用", exact: true })
      .click();
    await projects(page).click();
    await expect(
      page.getByText("更新の完了を待ってから移動します。", { exact: false }),
    ).toBeVisible();
    gate.releasePost();
    await expect.poll(gate.reads).toBeGreaterThan(0);
    await expect(
      page.getByText(
        "更新または下書きの保存に失敗したため、移動を中止しました。",
        { exact: false },
      ),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/profile");
    await expect(
      page
        .locator(".principle-fields")
        .getByLabel("原則", { exact: true })
        .last(),
    ).toHaveValue("見出しと本文の強弱を付ける");
    await expect(
      page
        .locator(".editor-actions")
        .getByRole("alert")
        .filter({ hasText: "下書きを保存できません" }),
    ).toBeVisible();
  } finally {
    gate.releasePost();
    gate.releaseRead();
    await removeFixtureReference(page, reference.id);
  }
});
