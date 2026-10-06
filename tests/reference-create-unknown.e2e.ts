import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { SavedReference } from "../src/domain/reference";
import { initialState } from "../src/client/state";
const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const data = await (await request.get(base)).json();
    const r = data.references.find((r: SavedReference) => r.id === id);
    if (r)
      expect(
        (
          await request.delete(`${base}/${id}`, {
            data: { version: r.version },
          })
        ).ok(),
      ).toBe(true);
  }
});
const input = (name: string, url = "") => ({
  name,
  url,
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
async function png(name: string) {
  return {
    name,
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 1440, height: 1000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer(),
  };
}
async function setup(
  page: Page,
  profile: boolean,
  kind: string,
  importedProjectId?: string,
) {
  const label = profile ? "Profile" : "Project";
  await page.setViewportSize({ width: profile ? 390 : 1440, height: 1000 });
  let base = "/api/profile/references",
    path = "/profile";
  if (!profile) {
    const p = importedProjectId
      ? { id: importedProjectId }
      : await (
          await page.request.post("/api/projects", {
            data: {
              brief: { name: `Reference unknown ${kind}` },
              useTaste: false,
            },
          })
        ).json();
    base = `/api/projects/${p.id}/references`;
    path = `/projects/${p.id}/inspiration`;
  }
  await page.goto(path);
  if (profile)
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
  const url = page.getByRole("textbox", { name: "Reference URL", exact: true }),
    add = page.getByRole("button", { name: "参考を追加", exact: true }),
    file = page.getByLabel("画像を選ぶ", { exact: true }),
    register = page.getByRole("button", { name: "画像を登録", exact: true }),
    recovery = page.getByRole("region", {
      name: "参考の追加結果を確認",
      exact: true,
    });
  await expect(url).toBeEnabled();
  return { base, path, label, profile, url, add, file, register, recovery };
}
function posts(page: Page, base: string) {
  let count = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === base && r.method() === "POST") count++;
  });
  return () => count;
}
async function actual(page: Page, base: string) {
  return (await (await page.request.get(base)).json())
    .references as SavedReference[];
}
async function ordinaryAdd(
  f: Awaited<ReturnType<typeof setup>>,
  kind: string,
  value: string,
) {
  if (kind === "URL") {
    await f.url.fill(value);
    await f.add.click();
  } else {
    await f.file.setInputFiles(await png(value));
    await f.register.click();
  }
}
async function prepare(f: Awaited<ReturnType<typeof setup>>) {
  await f.recovery
    .getByRole("checkbox", {
      name: "重複する可能性を確認し、別の追加を準備する",
      exact: true,
    })
    .check();
  await f.recovery
    .getByRole("button", { name: "別の追加を準備", exact: true })
    .click();
  await expect(f.recovery).toHaveCount(0);
}
for (const profile of [true, false])
  for (const kind of ["URL", "image"])
    test(`${profile ? "Profile" : "Project"} lost ${kind} create receipt blocks both creation entries and separates candidate checks from a new intention`, async ({
      page,
    }) => {
      const f = await setup(page, profile, kind),
        count = posts(page, f.base);
      const original =
        kind === "URL"
          ? `https://unknown.example/${"x".repeat(600)}/${crypto.randomUUID()}`
          : `lost-${crypto.randomUUID()}.png`;
      const next =
        kind === "URL"
          ? `https://next.example/${crypto.randomUUID()}`
          : `separate-${crypto.randomUUID()}.png`;
      const candidateInput = input(
        kind === "URL" ? "Existing same URL" : original,
        kind === "URL" ? original : "",
      );
      const existing = await (
        await page.request.post(f.base, { data: candidateInput })
      ).json();
      created.push({ base: f.base, id: existing.id });
      const existingCard = page.locator(".reference-card").filter({
        has: page.getByRole("heading", {
          name: existing.name,
          level: 3,
          exact: true,
        }),
      });
      if (profile && kind === "URL")
        await expect(existingCard).toBeVisible({ timeout: 10000 });
      let first = true,
        failReads = false,
        holdRead = false,
        acceptedId = "";
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      await page.route(`**${f.base}`, async (route) => {
        if (route.request().method() === "POST") {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          const saved = await response.json();
          created.push({ base: f.base, id: saved.id });
          if (first) {
            first = false;
            acceptedId = saved.id;
            failReads = true;
            return route.fulfill({
              status: 503,
              json: { message: "Lost initial create reply after commit" },
            });
          }
          return route.fulfill({ response });
        }
        if (failReads)
          return route.fulfill({
            status: 503,
            json: { message: "Unknown creation candidate GET failed" },
          });
        const response = await route.fetch();
        if (holdRead) {
          entered();
          await gate;
        }
        return route.fulfill({ response });
      });
      await ordinaryAdd(f, kind, original);
      await expect(f.recovery).toBeVisible();
      await expect(f.add).toBeDisabled();
      await expect(f.file).toBeDisabled();
      await expect(f.url).toBeEditable();
      if (profile && kind === "URL") {
        await existingCard
          .getByRole("textbox", { name: "好きな点", exact: true })
          .fill("Existing reference remains editable during unknown creation");
        await existingCard
          .getByRole("button", { name: "観点・メモを保存", exact: true })
          .click();
        await expect(
          existingCard.getByRole("textbox", { name: "好きな点", exact: true }),
        ).toBeEditable();
        await expect(
          existingCard.getByRole("button", {
            name: "観点・メモを保存",
            exact: true,
          }),
        ).toBeDisabled();
        expect(
          (await actual(page, f.base)).find((r) => r.id === existing.id),
        ).toMatchObject({
          version: 2,
          likes: "Existing reference remains editable during unknown creation",
        });
        await expect(f.recovery).toBeVisible();
        await expect(f.add).toBeDisabled();
      }
      expect(count()).toBe(1);
      const same = (await actual(page, f.base)).filter((r) =>
        kind === "URL" ? r.url === original : r.name === original,
      );
      expect(same).toHaveLength(2);
      expect(same.some((r) => r.id === acceptedId)).toBe(true);
      const newerURL = `https://edited.example/${crypto.randomUUID()}`;
      await f.url.fill(newerURL);
      await f.url.press("Enter");
      expect(count()).toBe(1);
      await expect(f.recovery).toContainText(original);
      await f.recovery
        .getByRole("button", { name: "追加候補を確認", exact: true })
        .click();
      await expect(
        f.recovery
          .getByRole("alert")
          .filter({ hasText: "候補を確認できませんでした" }),
      ).toBeVisible();
      await expect(f.recovery.getByRole("checkbox")).toHaveCount(0);
      expect(count()).toBe(1);
      failReads = false;
      holdRead = true;
      await f.recovery
        .getByRole("button", { name: "追加候補を確認", exact: true })
        .click();
      await started;
      try {
        await f.url.fill(kind === "URL" ? next : newerURL);
        await expect(f.add).toBeDisabled();
      } finally {
        release();
      }
      holdRead = false;
      await expect(f.recovery).toContainText("同じURLまたは参考名の候補: 2件");
      await expect(f.recovery).toContainText(
        "一致しても今回の追加結果とは限りません",
      );
      await expect(f.url).toHaveValue(kind === "URL" ? next : newerURL);
      expect(count()).toBe(1);
      await f.recovery.getByRole("checkbox").check();
      failReads = true;
      await f.recovery
        .getByRole("button", { name: "追加候補を確認", exact: true })
        .click();
      await expect(
        f.recovery
          .getByRole("alert")
          .filter({ hasText: "候補を確認できませんでした" }),
      ).toBeVisible();
      await expect(f.recovery.getByRole("checkbox")).toHaveCount(0);
      expect(count()).toBe(1);
      failReads = false;
      await f.recovery
        .getByRole("button", { name: "追加候補を確認", exact: true })
        .click();
      await expect(f.recovery.getByRole("checkbox")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(profile ? 390 : 1440);
      mkdirSync("../evidence/reference-create-unknown-ui", { recursive: true });
      await page.screenshot({
        path: `../evidence/reference-create-unknown-ui/unknown-${f.label}-${kind}.png`,
        fullPage: true,
      });
      await prepare(f);
      expect(count()).toBe(1);
      await expect(f.add).toBeEnabled();
      await expect(f.file).toBeEnabled();
      await ordinaryAdd(f, kind, next);
      await expect.poll(count).toBe(2);
      await expect(f.add).toBeEnabled();
      const after = await actual(page, f.base);
      expect(
        after.filter((r) =>
          kind === "URL" ? r.url === original : r.name === original,
        ),
      ).toHaveLength(2);
      const separate = after.filter((r) =>
        kind === "URL" ? r.url === next : r.name === next,
      );
      expect(separate).toHaveLength(1);
      if (kind === "image") expect(separate[0].assetId).toBeTruthy();
      mkdirSync("../evidence/reference-create-unknown-ui", { recursive: true });
      await page.screenshot({
        path: `../evidence/reference-create-unknown-ui/${f.label}-${kind}.png`,
        fullPage: true,
      });
      writeFileSync(
        `../evidence/reference-create-unknown-ui/${f.label}-${kind}.json`,
        JSON.stringify(
          {
            scope: f.label,
            kind,
            acceptedId,
            candidateCount: 2,
            posts: count(),
            candidateGETFailureLock: true,
            lateCandidateGETKeptCurrentURL: true,
            preparePosts: 0,
            separateId: separate[0].id,
            realCodexCalls: (
              await (await page.request.get("/api/health")).json()
            ).codexCalls,
          },
          null,
          2,
        ),
      );
    });
for (const profile of [true, false])
  test(`${profile ? "Profile" : "Project"} accepted creation is retained when capture or image continuation fails`, async ({
    page,
  }) => {
    const f = await setup(page, profile, "continuation"),
      count = posts(page, f.base);
    await page.route(`**${f.base}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      created.push({ base: f.base, id: (await response.json()).id });
      return route.fulfill({ response });
    });
    for (const [kind, value, suffix] of [
      ["URL", `https://continuation.example/${crypto.randomUUID()}`, "jobs"],
      ["image", `continuation-${crypto.randomUUID()}.png`, "image"],
    ]) {
      await page.route(`**${f.base}/*/${suffix}`, (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 503,
              json: { message: `Known created ${suffix} continuation failed` },
            })
          : route.continue(),
      );
      const before = count();
      await ordinaryAdd(f, kind, value);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: `Known created ${suffix} continuation failed` }),
      ).toBeVisible();
      await expect(f.recovery).toHaveCount(0);
      await expect(f.add).toBeEnabled();
      await expect(f.file).toBeEnabled();
      expect(count()).toBe(before + 1);
      const refs = await actual(page, f.base);
      const saved = refs.find((r) =>
        kind === "URL" ? r.url === value : r.name === value,
      )!;
      expect(saved).toBeTruthy();
      expect(saved.version).toBe(1);
      await expect(f.url).toHaveValue("");
      const card = page.locator(".reference-card").filter({
        has: page.getByRole("heading", {
          name: saved.name,
          level: 3,
          exact: true,
        }),
      });
      await expect(card).toBeVisible();
      await page.unroute(`**${f.base}/*/${suffix}`);
      if (kind === "image") {
        await card
          .getByLabel(`${saved.name}の画像をアップロード`, { exact: true })
          .setInputFiles(await png(value));
        await expect(card.getByRole("img")).toBeVisible();
        expect(count()).toBe(before + 1);
      }
    }
  });
test("unknown network, malformed and invalid create receipts require a GET check and explicit separate intention", async ({
  page,
}) => {
  const f = await setup(page, false, "invalid-receipts"),
    count = posts(page, f.base);
  for (const kind of [
    "uncommitted503",
    "network",
    "nonJSON",
    "missingID",
    "missingDefault",
    "invalidMetadata",
  ]) {
    await page.route(`**${f.base}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (kind === "uncommitted503")
        return route.fulfill({
          status: 503,
          json: { message: "Unknown create before fixture commit" },
        });
      if (kind === "network") return route.abort("failed");
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const saved = await response.json();
      created.push({ base: f.base, id: saved.id });
      if (kind === "nonJSON")
        return route.fulfill({
          status: 201,
          contentType: "text/plain",
          body: "invalid initial receipt",
        });
      if (kind === "missingID") delete saved.id;
      else if (kind === "missingDefault") delete saved.likes;
      else saved.analysis = { findings: "invalid" };
      return route.fulfill({ status: 201, json: saved });
    });
    const value = `https://${kind.toLowerCase()}.example/${crypto.randomUUID()}`,
      before = count();
    await ordinaryAdd(f, "URL", value);
    await expect(f.recovery).toBeVisible();
    await expect(f.add).toBeDisabled();
    await expect(f.file).toBeDisabled();
    await f.url.press("Enter");
    expect(count()).toBe(before + 1);
    await f.recovery
      .getByRole("button", { name: "追加候補を確認", exact: true })
      .click();
    await expect(f.recovery).toContainText(
      `同じURLまたは参考名の候補: ${["uncommitted503", "network"].includes(kind) ? 0 : 1}件`,
    );
    await expect(f.recovery).toContainText(
      "候補がなくても、追加されなかったことを保証しません",
    );
    await prepare(f);
    expect(count()).toBe(before + 1);
    await page.unroute(`**${f.base}`);
  }
});
test("actual prewrite validation and reference limit remain correctable in both scopes", async ({
  page,
}) => {
  for (const profile of [true, false]) {
    const f = await setup(page, profile, "known-rejections"),
      count = posts(page, f.base),
      before = await actual(page, f.base);
    await ordinaryAdd(
      f,
      "URL",
      `https://invalid.example:444/${crypto.randomUUID()}`,
    );
    await expect(
      page.getByRole("alert").filter({ hasText: "標準ポート" }),
    ).toBeVisible();
    await expect(f.recovery).toHaveCount(0);
    await expect(f.add).toBeEnabled();
    expect(await actual(page, f.base)).toEqual(before);
    for (let index = before.length; index < 20; index++) {
      const response = await page.request.post(f.base, {
        data: input(`Own limit ${profile} ${index}`),
      });
      expect(response.ok()).toBe(true);
      created.push({ base: f.base, id: (await response.json()).id });
    }
    await ordinaryAdd(f, "URL", `https://limit.example/${crypto.randomUUID()}`);
    await expect(
      page.getByRole("alert").filter({ hasText: "20件まで" }),
    ).toBeVisible();
    await expect(f.recovery).toHaveCount(0);
    await expect(f.add).toBeEnabled();
    expect(await actual(page, f.base)).toHaveLength(20);
    expect(count()).toBe(2);
  }
});
test("unknown creation recovery accepts legal legacy References without rewriting them", async ({
  page,
}) => {
  const old = [
    { id: crypto.randomUUID(), name: "", url: "", aspects: [] },
    {
      id: crypto.randomUUID(),
      name: "Long legacy name " + "x".repeat(210),
      url: `relative/legacy-${crypto.randomUUID()}`,
      aspects: [],
    },
    {
      id: crypto.randomUUID(),
      name: "Legacy empty selections",
      url: "",
      aspects: [],
    },
  ];
  const imported = await page.request.post("/api/migration/browser", {
    data: { ...initialState, references: old },
  });
  expect(imported.ok()).toBe(true);
  const { projectId } = await imported.json();
  const f = await setup(page, false, "legacy", projectId),
    count = posts(page, f.base),
    importedIds = old.map((r) =>
      createHash("sha256")
        .update(r.id)
        .digest("hex")
        .slice(0, 32)
        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"),
    ),
    before = (await actual(page, f.base)).filter((r) =>
      importedIds.includes(r.id),
    );
  for (const id of importedIds) created.push({ base: f.base, id });
  expect(before).toHaveLength(3);
  expect(before.every((r) => r.selections.length === 0)).toBe(true);
  await page.route(`**${f.base}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    created.push({ base: f.base, id: (await response.json()).id });
    return route.fulfill({
      status: 503,
      json: { message: "Unknown create in legacy project" },
    });
  });
  await ordinaryAdd(
    f,
    "URL",
    `https://legacy-unknown.example/${crypto.randomUUID()}`,
  );
  await expect(f.recovery).toBeVisible();
  await f.recovery
    .getByRole("button", { name: "追加候補を確認", exact: true })
    .click();
  await expect(f.recovery).toContainText("同じURLまたは参考名の候補: 1件");
  await expect(f.recovery.getByRole("checkbox")).toBeVisible();
  await prepare(f);
  expect(count()).toBe(1);
  const after = await actual(page, f.base);
  expect(after.filter((r) => before.some((b) => b.id === r.id))).toEqual(
    before,
  );
});
