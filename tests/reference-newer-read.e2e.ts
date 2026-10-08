import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import type { SavedReference } from "../src/domain/reference";
const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const data = await (await request.get(base)).json();
    const ref = data.references.find((r: SavedReference) => r.id === id);
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
const input = (name: string) => ({
  name,
  url: "",
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
async function setup(
  page: Page,
  profile: boolean,
  width: number,
  kind: string,
) {
  await page.setViewportSize({ width, height: 1000 });
  let base = "/api/profile/references",
    path = "/profile",
    scope = "profile";
  if (!profile) {
    const p = await (
      await page.request.post("/api/projects", {
        data: {
          brief: { name: `Newer Reference ${kind} ${width}` },
          useTaste: false,
        },
      })
    ).json();
    scope = p.id;
    base = `/api/projects/${p.id}/references`;
    path = `/projects/${p.id}/inspiration`;
  }
  const ref: SavedReference = await (
    await page.request.post(base, { data: input(`Accepted ${kind} ${width}`) })
  ).json();
  created.push({ base, id: ref.id });
  await page.goto(path);
  if (profile)
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
  const newerName =
    kind === "notes"
      ? `Known newer ${profile ? "Profile" : "Project"} ${width}`
      : kind === "accept"
        ? `External after reviewed acceptance ${profile}`
        : ref.name;
  const card = page.locator(".reference-card").filter({
    has: page
      .getByRole("heading", { name: ref.name, exact: true, level: 3 })
      .or(
        page.getByRole("heading", { name: newerName, exact: true, level: 3 }),
      ),
  });
  await expect(card).toBeVisible();
  return {
    base,
    path,
    scope,
    ref,
    card,
    key: `tasteprint.${scope}.reference.${ref.id}`,
  };
}
async function holdReply(page: Page, endpoint: string) {
  let release!: () => void,
    entered!: () => void,
    accepted!: SavedReference,
    failRead = false,
    writes = 0;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const base = endpoint.replace(
    /\/[a-f0-9-]+(?:\/(?:image|accept(?:-policy)?))?$/,
    "",
  );
  await page.route(`**${base}`, (route) =>
    failRead && route.request().method() === "GET"
      ? route.fulfill({
          status: 503,
          json: { message: "Read failed after delayed reply" },
        })
      : route.continue(),
  );
  await page.route(`**${endpoint}`, async (route: Route) => {
    if (route.request().method() === "GET" || ++writes !== 1)
      return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const reply = await response.json();
    accepted = reply.reference ?? reply;
    entered();
    await gate;
    await route.fulfill({ response });
  });
  return {
    started,
    release,
    fail: () => (failRead = true),
    recover: () => (failRead = false),
    accepted: () => accepted,
    writes: () => writes,
  };
}
async function image(color: string) {
  return {
    name: "reference.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 1440, height: 1000, channels: 3, background: color },
    })
      .png()
      .toBuffer(),
  };
}
for (const profile of [true, false])
  for (const width of [1440, 390]) {
    const label = profile ? "Profile" : "Project";
    test(`${label} delayed Reference save preserves a known higher version and honest draft base at ${width}px`, async ({
      page,
    }) => {
      const f = await setup(page, profile, width, "notes");
      // Keep the same card locator after its server name changes.
      const card = f.card;
      const notes = card.getByRole("textbox", {
          name: "好きな点",
          exact: true,
        }),
        save = card.getByRole("button", {
          name: "観点・メモを保存",
          exact: true,
        });
      const held = await holdReply(page, `${f.base}/${f.ref.id}`);
      await notes.fill("My accepted version two notes");
      await save.click();
      await held.started;
      try {
        expect(held.accepted().version).toBe(2);
        const external = await page.request.patch(`${f.base}/${f.ref.id}`, {
          data: {
            ...input(`Known newer ${label} ${width}`),
            likes: "External version three notes",
            version: 2,
          },
        });
        expect(external.ok()).toBe(true);
        expect((await external.json()).version).toBe(3);
        // Real polling, real API versions: no DTO replacement or clock changes.
        await expect(card.getByRole("heading", { level: 3 })).toHaveText(
          `Known newer ${label} ${width}`,
          { timeout: 10000 },
        );
        held.fail();
      } finally {
        held.release();
      }
      await expect(card.getByRole("alert")).toContainText("別の操作で更新");
      await expect(notes).toHaveValue("My accepted version two notes");
      await expect(notes).toBeEditable();
      await expect(save).toBeDisabled();
      await expect(card.getByRole("heading", { level: 3 })).toHaveText(
        `Known newer ${label} ${width}`,
      );
      await expect
        .poll(() =>
          page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)!).baseVersion,
            f.key,
          ),
        )
        .toBe(2);
      const stored = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        f.key,
      );
      expect(stored.baseVersion).toBe(2);
      expect(held.writes()).toBe(1);
      const actual = (
        await (await page.request.get(f.base)).json()
      ).references.find((r: SavedReference) => r.id === f.ref.id);
      expect(actual.version).toBe(3);
      expect(actual.likes).toBe("External version three notes");
      mkdirSync("../evidence/reference-newer-read-ui", { recursive: true });
      await card
        .getByRole("button", { name: "最新の保存内容を読み込む", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `../evidence/reference-newer-read-ui/${label}-${width}.png`,
        fullPage: true,
      });
      writeFileSync(
        `../evidence/reference-newer-read-ui/${label}-${width}.json`,
        JSON.stringify(
          {
            width,
            scope: label,
            acceptedVersion: 2,
            knownVersion: 3,
            draft: stored,
            actual,
            writesBeforeRecovery: held.writes(),
            realPolling: true,
          },
          null,
          2,
        ),
      );
      held.recover();
      await page
        .getByRole("button", { name: "一覧を再取得", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "一覧を再取得", exact: true }),
      ).toHaveCount(0);
      expect(held.writes()).toBe(1);
      await expect(save).toBeDisabled();
      await page.reload();
      if (profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      await expect(notes).toHaveValue("My accepted version two notes");
      await expect(card.getByRole("alert")).toContainText("別の操作で更新");
      await expect(save).toBeDisabled();
      await card
        .getByRole("button", { name: "最新の保存内容を読み込む", exact: true })
        .click();
      await expect(notes).toHaveValue("External version three notes");
      expect(held.writes()).toBe(1);
      await notes.fill("My reviewed version four notes");
      await save.click();
      await expect(save).toBeDisabled();
      await expect(notes).toBeEditable();
      expect(held.writes()).toBe(2);
      const final = (
        await (await page.request.get(f.base)).json()
      ).references.find((r: SavedReference) => r.id === f.ref.id);
      expect(final).toMatchObject({
        version: 4,
        name: `Known newer ${label} ${width}`,
        likes: "My reviewed version four notes",
      });
    });
  }
for (const profile of [true, false])
  test(`${profile ? "Profile" : "Project"} delayed image reply retains the higher version asset`, async ({
    page,
  }) => {
    const f = await setup(page, profile, 1440, "image"),
      held = await holdReply(page, `${f.base}/${f.ref.id}/image`);
    await f.card
      .getByLabel(`${f.ref.name}の画像をアップロード`, { exact: true })
      .setInputFiles(await image("white"));
    await held.started;
    let newest!: SavedReference;
    try {
      expect(held.accepted().version).toBe(2);
      const png = await image("black");
      const response = await page.request.post(`${f.base}/${f.ref.id}/image`, {
        multipart: {
          version: "2",
          image: { name: png.name, mimeType: png.mimeType, buffer: png.buffer },
        },
      });
      expect(response.ok()).toBe(true);
      newest = await response.json();
      expect(newest.version).toBe(3);
      expect(newest.assetId).not.toBe(held.accepted().assetId);
      await expect(f.card.getByRole("img")).toHaveAttribute(
        "src",
        `${f.base}/${f.ref.id}/image?v=${newest.assetId}`,
        { timeout: 10000 },
      );
      held.fail();
    } finally {
      held.release();
    }
    await expect(
      page.getByRole("alert").filter({ hasText: "参考一覧の読み込みに失敗" }),
    ).toBeVisible();
    await expect(f.card.getByRole("img")).toHaveAttribute(
      "src",
      `${f.base}/${f.ref.id}/image?v=${newest.assetId}`,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).baseVersion,
          f.key,
        ),
      )
      .toBe(3);
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      f.key,
    );
    expect(stored.baseVersion).toBe(3);
    expect(held.writes()).toBe(1);
    held.recover();
    await page
      .getByRole("button", { name: "一覧を再取得", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "一覧を再取得", exact: true }),
    ).toHaveCount(0);
    expect(held.writes()).toBe(1);
    await page.reload();
    if (profile)
      await page
        .getByRole("button", { name: "参考を集める", exact: true })
        .click();
    await expect(f.card.getByRole("img")).toHaveAttribute(
      "src",
      `${f.base}/${f.ref.id}/image?v=${newest.assetId}`,
    );
  });
for (const profile of [true, false])
  test(`${profile ? "Profile" : "Project"} delayed acceptance retains newer metadata and adopts the reviewed finding once`, async ({
    page,
  }) => {
    let profilePosts = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/profile"
      )
        profilePosts++;
    });
    const f = await setup(page, profile, 390, "accept");
    await f.card
      .getByLabel(`${f.ref.name}の画像をアップロード`, { exact: true })
      .setInputFiles(await image("white"));
    await expect(f.card.getByRole("img")).toBeVisible();
    await f.card.getByLabel("送信対象を確認しました").check();
    await f.card
      .getByRole("button", { name: "Codexで分析する", exact: true })
      .click();
    await expect(
      f.card.getByText("画像上部の見出し", { exact: true }),
    ).toBeVisible();
    const original = (
      await (await page.request.get(f.base)).json()
    ).references.find((r: SavedReference) => r.id === f.ref.id);
    const held = await holdReply(
      page,
      `${f.base}/${f.ref.id}/${profile ? "accept" : "accept-policy"}`,
    );
    await f.card
      .getByRole("button", {
        name: /^(設計方針として採用|プロジェクト方針として保存)$/,
        exact: true,
      })
      .click();
    await held.started;
    const latestName = `External after reviewed acceptance ${profile}`;
    try {
      expect(held.accepted().version).toBe(original.version + 1);
      const updated = await page.request.patch(`${f.base}/${f.ref.id}`, {
        data: {
          ...input(latestName),
          likes: "External input resets earlier analysis",
          version: held.accepted().version,
        },
      });
      expect(updated.ok()).toBe(true);
      expect((await updated.json()).version).toBe(original.version + 2);
      await expect(f.card.getByRole("heading", { level: 3 })).toHaveText(
        latestName,
        { timeout: 10000 },
      );
      held.fail();
    } finally {
      held.release();
    }
    if (profile) {
      await expect(
        page.getByRole("button", { name: "DNA・原則", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page
          .locator(".principle-fields")
          .getByLabel("原則", { exact: true })
          .last(),
      ).toHaveValue(original.analysis.findings[0].recommendation);
      await page
        .getByRole("button", { name: "参考を集める", exact: true })
        .click();
    }
    const card = f.card;
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(
      latestName,
    );
    await expect(
      card.getByRole("textbox", { name: "好きな点", exact: true }),
    ).toHaveValue("External input resets earlier analysis");
    await expect(
      card.getByRole("button", {
        name: /^(採用済み|方針保存済み)$/,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      card.getByText("画像上部の見出し", { exact: true }),
    ).toHaveCount(0);
    expect(held.writes()).toBe(1);
    held.recover();
    await page
      .getByRole("button", { name: "一覧を再取得", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "一覧を再取得", exact: true }),
    ).toHaveCount(0);
    expect(held.writes()).toBe(1);
    if (profile) {
      await page
        .getByRole("button", { name: "DNA・原則", exact: true })
        .click();
      expect(profilePosts).toBe(0);
      const adopted = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("tasteprint.profile.draft")!)
            .principles,
      );
      expect(
        adopted.filter(
          (principle: { id: string }) =>
            principle.id === `reference:${f.ref.id}:0`,
        ),
      ).toEqual([
        {
          id: `reference:${f.ref.id}:0`,
          target: original.analysis.findings[0].aspect,
          text: original.analysis.findings[0].recommendation,
          reason: original.analysis.findings[0].interpretation,
          sources: [original.name, original.analysis.findings[0].evidence],
          locked: false,
        },
      ]);
    }
  });
