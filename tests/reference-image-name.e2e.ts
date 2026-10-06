import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import type { SavedReference } from "../src/domain/reference";

const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const r = (await (await request.get(base)).json()).references.find(
      (r: SavedReference) => r.id === id,
    );
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
async function open(page: Page, profile: boolean, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  let base = "/api/profile/references",
    path = "/profile";
  if (!profile) {
    const p = await (
      await page.request.post("/api/projects", {
        data: {
          brief: { name: `Image preparation ${width}` },
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
  const form = page.getByRole("form", {
    name: "画像から参考を追加",
    exact: true,
  });
  await expect(form).toBeVisible();
  let creates = 0,
    images = 0;
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() === "POST" && p === base) creates++;
    if (
      r.method() === "POST" &&
      p.startsWith(`${base}/`) &&
      p.endsWith("/image")
    )
      images++;
  });
  return {
    base,
    form,
    name: form.getByRole("textbox", { name: "画像の参考名", exact: true }),
    file: form.getByLabel("画像を選ぶ", { exact: true }),
    register: form.getByRole("button", { name: "画像を登録", exact: true }),
    cancel: form.getByRole("button", {
      name: "画像の準備を取り消す",
      exact: true,
    }),
    creates: () => creates,
    images: () => images,
  };
}
async function image(name: string, format: "png" | "jpeg" | "webp" = "png") {
  return {
    name,
    mimeType: `image/${format}`,
    buffer: await sharp({
      create: { width: 40, height: 40, channels: 3, background: "white" },
    })
      [format]()
      .toBuffer(),
  };
}
async function saved(page: Page, base: string, name: string) {
  const refs: SavedReference[] = (await (await page.request.get(base)).json())
    .references;
  const r = refs.find((r) => r.name === name)!;
  expect(r).toBeTruthy();
  created.push({ base, id: r.id });
  return r;
}
for (const profile of [true, false])
  for (const width of [1440, 390]) {
    test(`${profile ? "Profile" : "Project"} ${width} image preparation preserves editable names, order and cancellation before writing`, async ({
      page,
    }) => {
      const f = await open(page, profile, width);
      const format = profile
        ? width === 390
          ? "webp"
          : "jpeg"
        : width === 390
          ? "jpeg"
          : "png";
      const longName =
        "参考画像-" +
        "a".repeat(197) +
        `.${format === "jpeg" ? "jpg" : format}`;
      const longImage = await image(longName, format);
      await expect(f.register).toBeDisabled();
      await f.name.fill("名前を先に入力");
      await f.name.press("Enter");
      expect(f.creates()).toBe(0);
      await f.file.setInputFiles(longImage);
      await expect(f.name).toHaveValue("名前を先に入力");
      await f.file.dispatchEvent("cancel");
      await expect(f.form).toContainText(longName);
      await expect(f.register).toBeEnabled();
      await f.name.fill("");
      await f.file.setInputFiles(await image("replacement.png"));
      await expect(f.name).toHaveValue("");
      await expect(f.register).toBeDisabled();
      await f.name.fill("名".repeat(201));
      await f.name.press("Enter");
      await expect(f.name).toHaveValue("名".repeat(201));
      await expect(f.form.getByRole("alert")).toContainText("1〜200文字");
      expect(f.creates()).toBe(0);
      expect(f.images()).toBe(0);
      await f.name.fill("名".repeat(200));
      await expect(f.register).toBeEnabled();
      const url = page.getByRole("textbox", {
        name: "Reference URL",
        exact: true,
      });
      await url.fill("https://keep-url.example/draft");
      await f.cancel.click();
      await expect(f.name).toHaveValue("");
      await expect(f.form.getByText(/選択中:/)).toHaveCount(0);
      await expect(url).toHaveValue("https://keep-url.example/draft");
      await f.file.setInputFiles({
        name: "large.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      });
      await expect(f.register).toBeDisabled();
      await expect(f.form.getByRole("alert")).toContainText("10MB以下");
      await f.cancel.click();
      await f.file.setInputFiles(longImage);
      await expect(f.name).toHaveValue(longName);
      await expect(f.register).toBeDisabled();
      await expect(f.form.getByRole("alert")).toContainText("1〜200文字");
      const name = `日本語の参考・${profile ? "共通" : "設計"}・${width}`;
      await f.name.fill(`  ${name}  `);
      await expect(f.register).toBeEnabled();
      expect(f.creates()).toBe(0);
      expect(f.images()).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const out = "../evidence/reference-image-name";
      mkdirSync(out, { recursive: true });
      await page.screenshot({
        path: `${out}/after-${profile ? "profile" : "project"}-${width}.png`,
        fullPage: true,
      });
      await f.name.press("Enter");
      const card = page.locator(".reference-card").filter({
        has: page.getByRole("heading", { name, exact: true, level: 3 }),
      });
      await expect(card.getByRole("img")).toBeVisible();
      await expect
        .poll(() =>
          card
            .getByRole("img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBe(40);
      const r = await saved(page, f.base, name);
      expect(r.version).toBe(2);
      expect(r.assetId).toBeTruthy();
      expect(r.name).toBe(name);
      expect(f.creates()).toBe(1);
      expect(f.images()).toBe(1);
      await expect(f.name).toHaveValue("");
      await expect(f.register).toBeDisabled();
      await expect(url).toHaveValue("https://keep-url.example/draft");
      const normal = `normal-${profile}-${width}.png`;
      await f.file.setInputFiles(await image(normal));
      await expect(f.name).toHaveValue(normal);
      expect(f.creates()).toBe(1);
      await f.register.click();
      await expect(
        page.getByAltText(`${normal}の参考画像`, { exact: true }),
      ).toBeVisible();
      await saved(page, f.base, normal);
      expect(f.creates()).toBe(2);
      expect(f.images()).toBe(2);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
    test(`${profile ? "Profile" : "Project"} ${width} image preparation survives prewrite rejection and protects pending and accepted continuation retry`, async ({
      page,
    }) => {
      const f = await open(page, profile, width);
      let attempts = 0,
        release!: () => void,
        entered!: () => void;
      const gate = new Promise<void>((r) => (release = r)),
        started = new Promise<void>((r) => (entered = r));
      await page.route(`**${f.base}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        if (++attempts === 1)
          return route.fulfill({
            status: 400,
            json: { message: "Rejected before writing" },
          });
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const ref = await response.json();
        created.push({ base: f.base, id: ref.id });
        entered();
        await gate;
        await route.fulfill({ response });
      });
      await page.route(`**${f.base}/*/image`, (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 503,
              json: { message: "Known card image failed" },
            })
          : route.continue(),
      );
      const name = `再試行する参考 ${profile} ${width}`;
      const file = await image("参考画像-" + "a".repeat(197) + ".png");
      const before = (await (await page.request.get(f.base)).json()).references;
      await f.file.setInputFiles(file);
      await f.name.fill(name);
      await f.register.click();
      await expect(
        page.getByRole("alert").filter({ hasText: "Rejected before writing" }),
      ).toBeVisible();
      expect(
        (await (await page.request.get(f.base)).json()).references,
      ).toEqual(before);
      await expect(f.form).toContainText(file.name);
      await expect(f.name).toHaveValue(name);
      await expect(f.register).toBeEnabled();
      expect(f.creates()).toBe(1);
      expect(f.images()).toBe(0);
      await f.register.click();
      await started;
      try {
        for (const control of [
          f.name,
          f.file,
          f.cancel,
          f.register,
          page.getByRole("button", { name: "参考を追加", exact: true }),
          page.getByRole("textbox", { name: "Reference URL", exact: true }),
        ])
          await expect(control).toBeDisabled();
        expect(f.creates()).toBe(2);
      } finally {
        release();
      }
      await expect(
        page.getByRole("alert").filter({ hasText: "Known card image failed" }),
      ).toBeVisible();
      await expect(f.name).toHaveValue("");
      await expect(f.register).toBeDisabled();
      await expect(f.form.getByText(/選択中:/)).toHaveCount(0);
      const r = await saved(page, f.base, name);
      expect(r.version).toBe(1);
      expect(r.assetId).toBeUndefined();
      const card = page.locator(".reference-card").filter({
        has: page.getByRole("heading", { name, exact: true, level: 3 }),
      });
      await page.unroute(`**${f.base}/*/image`);
      await card
        .getByLabel(`${name}の画像をアップロード`, { exact: true })
        .setInputFiles(file);
      await expect(card.getByRole("img")).toBeVisible();
      expect(f.creates()).toBe(2);
      expect(f.images()).toBe(2);
      expect(
        (await (await page.request.get(f.base)).json()).references.filter(
          (r: SavedReference) => r.name === name,
        ),
      ).toHaveLength(1);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
  }
for (const profile of [true, false])
  for (const kind of ["image", "URL"] as const)
    test(`${profile ? "Profile" : "Project"} ${kind} unknown receipt preserves image intent and blocks resends`, async ({
      page,
    }) => {
      const f = await open(page, profile, 390);
      const name = `利用者が指定した名前 ${profile}`;
      await page.route(`**${f.base}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const r = await response.json();
        created.push({ base: f.base, id: r.id });
        return route.fulfill({
          status: 503,
          json: { message: "Receipt lost after commit" },
        });
      });
      await f.name.fill(name);
      await f.file.setInputFiles(
        await image("参考画像-" + "a".repeat(197) + ".png"),
      );
      if (kind === "image") await f.register.click();
      else {
        await page
          .getByRole("textbox", { name: "Reference URL", exact: true })
          .fill(`https://pending-url.example/${crypto.randomUUID()}`);
        await page
          .getByRole("button", { name: "参考を追加", exact: true })
          .click();
      }
      const recovery = page.getByRole("region", {
        name: "参考の追加結果を確認",
        exact: true,
      });
      await expect(recovery).toBeVisible();
      for (const control of [
        f.name,
        f.file,
        f.cancel,
        f.register,
        page.getByRole("button", { name: "参考を追加", exact: true }),
      ])
        await expect(control).toBeDisabled();
      await recovery
        .getByRole("button", { name: "追加候補を確認", exact: true })
        .click();
      await expect(recovery).toContainText("同じURLまたは参考名の候補: 1件");
      expect(f.creates()).toBe(1);
      expect(f.images()).toBe(0);
      await recovery
        .getByRole("checkbox", {
          name: "重複する可能性を確認し、別の追加を準備する",
          exact: true,
        })
        .check();
      await recovery
        .getByRole("button", { name: "別の追加を準備", exact: true })
        .click();
      await expect(recovery).toHaveCount(0);
      await expect(f.name).toHaveValue(name);
      if (kind === "image") {
        await expect(f.register).toBeDisabled();
        await expect(f.form.getByText(/選択中:/)).toHaveCount(0);
        expect(
          await f.file.evaluate((e: HTMLInputElement) => e.files?.length),
        ).toBe(0);
        await f.file.setInputFiles(await image("another.png"));
        await expect(f.name).toHaveValue(name);
      } else {
        expect(
          await f.file.evaluate((e: HTMLInputElement) => e.files?.length),
        ).toBe(1);
        await expect(f.form.getByText(/選択中:/)).toBeVisible();
      }
      await expect(f.register).toBeEnabled();
      await f.cancel.click();
      expect(f.creates()).toBe(1);
      expect(f.images()).toBe(0);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
