import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { initialState } from "../src/client/state";

let session = "";
let projectId = "";
test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/pair", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: { code: "e2e-pair-code" },
  });
  expect(response.ok()).toBe(true);
  session = response.headers()["set-cookie"].split(";")[0].split("=")[1];
  const created = await request.post("/api/projects", {
    headers: { Cookie: `tasteprint_session=${session}` },
    data: { brief: { name: "Workspace regression" }, useTaste: false },
  });
  projectId = (await created.json()).id;
});
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "tasteprint_session",
      value: session,
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
});

test("foundation, proposal staging, undo, persistence, and export work together", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/projects/${projectId}/foundation`);
  await expect(
    page.getByRole("heading", { name: "Foundation." }),
  ).toBeVisible();
  await expect(page.getByText(/確定履歴（revision 1/)).toBeVisible();
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#526f99");
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("invalid");
  await expect(
    page.getByRole("button", { name: "変更を保存", exact: true }),
  ).toBeDisabled();
  await expect(page.frameLocator("iframe").locator(".sample-app")).toHaveCSS(
    "--preview-accent",
    "#526f99",
  );
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#526f99");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByText(/確定履歴（revision 2/)).toBeVisible();
  await page.getByRole("button", { name: "角丸をもう少し弱くしたい" }).click();
  await expect(page.getByText("プレビューに仮反映しています")).toBeVisible();
  await page.getByRole("button", { name: "候補 2", exact: true }).click();
  await expect(page.frameLocator("iframe").locator(".sample-app")).toHaveCSS(
    "border-radius",
    "2px",
  );
  await page.getByRole("button", { name: "採用する" }).click();
  await expect(page.getByText(/確定履歴（revision 3/)).toBeVisible();
  await page.getByRole("tab", { name: "Radius", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "radius", exact: true }),
  ).toHaveValue("2");
  await page.getByLabel("radiusをAI変更からロック", { exact: true }).check();
  await page
    .locator(".foundation-field")
    .filter({
      has: page.getByRole("spinbutton", { name: "radius", exact: true }),
    })
    .getByText("適用範囲・例外・決定理由・出典", { exact: true })
    .click();
  await page
    .getByLabel("radius rationale", { exact: true })
    .fill("一覧性を優先");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByText(/確定履歴（revision 4/)).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Radius", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "radius", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByLabel("radiusをAI変更からロック", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("spinbutton", { name: "radius", exact: true })
    .fill("12");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "radius", exact: true }),
  ).toHaveValue("2");
  await page.getByText(/確定履歴（revision/).click();
  await page.getByRole("button", { name: "r2を復元", exact: true }).click();
  await expect(page.getByText(/確定履歴（revision 5/)).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "radius", exact: true }),
  ).toHaveValue("6");
  await page
    .getByRole("spinbutton", { name: "radius", exact: true })
    .fill("14");
  await page.locator("nav").getByRole("link", { name: "Export" }).click();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const exported = JSON.parse(
    await readFile((await (await jsonDownload).path())!, "utf8"),
  );
  expect(exported.revision).toBe(5);
  expect(exported.design.radius).toBe(6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "DESIGN.md" }).click();
  expect((await download).suggestedFilename()).toMatch(/-r5-DESIGN.md$/);
  expect(errors).toEqual([]);
});

test("reference and taste workflow preserves explicit choices", async ({
  page,
}) => {
  await page.addInitScript((state) => {
    if (!localStorage.getItem("tasteprint.mock.v1"))
      localStorage.setItem(
        "tasteprint.mock.v1",
        JSON.stringify({
          ...state,
          references: [
            {
              id: "legacy-ref",
              name: "Earlier reference",
              url: "https://earlier.example",
              aspects: ["Colors"],
            },
          ],
        }),
      );
  }, initialState);
  await page.goto(`/projects/${projectId}/inspiration`);
  await page.goto("/projects/legacy/inspiration");
  await expect(
    page.getByRole("heading", { name: "Earlier reference", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Earlier reference" }) })
    .getByRole("button", { name: "削除", exact: true })
    .click();
  expect(
    await page.evaluate(() => localStorage.getItem("tasteprint.mock.v1")),
  ).toContain("legacy-ref");
  await page
    .getByRole("textbox", { name: "Reference URL" })
    .fill("https://example.com");
  await page.getByRole("button", { name: "参考を追加", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "example.com" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "30秒以内に取得できませんでした。画像アップロードで続行できます。",
    ),
  ).toBeVisible();
  const png = await sharp({
    create: { width: 1440, height: 1000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("example.comの画像をアップロード").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByAltText("example.comの参考画像")).toBeVisible();
  await page.getByLabel("好きな点", { exact: true }).fill("見出しの強弱");
  await page.getByRole("button", { name: "観点・メモを保存" }).click();
  await page.getByLabel("送信対象を確認しました").check();
  await page.getByRole("button", { name: "Codexで分析する" }).click();
  await expect(
    page.getByText("画像上部の見出し", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "設計方針として採用" }).click();
  await expect(page.getByRole("button", { name: "採用済み" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "採用済み" })).toBeVisible();
  await page.screenshot({
    path: "test-results/inspiration-desktop.png",
    fullPage: true,
  });
  await page.goto("/profile");
  await page.getByLabel("density-0", { exact: true }).selectOption("a");
  await page.getByLabel("density-1", { exact: true }).selectOption("skip");
  await page
    .getByRole("button", { name: "共通の好みを保存", exact: true })
    .click();
  await expect(page.getByText("共通の好みを保存しました")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("density-1", { exact: true })).toHaveValue(
    "skip",
  );
});

test("preview search, form, dialog, and narrow layout are usable", async ({
  page,
}) => {
  await page.goto(`/projects/${projectId}/preview`);
  await page
    .frameLocator("iframe")
    .getByRole("textbox", { name: "Search projects" })
    .fill("Brand");
  await expect(page.frameLocator("iframe").locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("button", { name: "Saved in preview" }),
  ).toBeVisible();
  await page.goto(`/projects/${projectId}/components`);
  await page.getByRole("button", { name: "Dialog", exact: true }).click();
  await page.getByRole("button", { name: "Open dialog" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto(`/projects/${projectId}/foundation`);
  await page.getByRole("button", { name: "対話パネルを閉じる" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Foundation." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("all routes render and foundation screenshot is captured", async ({
  page,
}) => {
  for (const route of [
    "inspiration",
    "taste",
    "foundation",
    "components",
    "patterns",
    "preview",
    "review",
    "export",
  ]) {
    await page.goto(`/projects/${projectId}/${route}`);
    await expect(page.locator("h1")).toBeVisible();
  }
  await page.goto(`/projects/${projectId}/foundation`);
  await page.screenshot({
    path: "test-results/foundation-desktop.png",
    fullPage: true,
  });
});

test("review images, evidence, dismissal, preview and explicit revision apply", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(`/projects/${projectId}/review`);
  await page.getByRole("button", { name: "3画面を撮影してレビュー" }).click();
  await expect(page.getByText("要判断の指摘数:", { exact: false })).toBeVisible(
    { timeout: 90000 },
  );
  await expect(page.getByText("検証未完了:", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: "test-results/review-desktop.png" });
  await page.getByText("入力画像・DNA・関連ルール", { exact: true }).click();
  await expect(page.locator(".review-results img")).toHaveCount(3);
  await page
    .getByRole("button", { name: "見送る", exact: true })
    .first()
    .click();
  await expect(page.getByText("見送り済み: 理由なし")).toBeVisible();
  await page.getByRole("button", { name: "修正案を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "仮Preview:", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "仮Preview · 未適用" }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(3);
  await page.getByRole("button", { name: "まとめて適用", exact: true }).click();
  await expect(
    page.getByText("古い結果 · 再レビューしてください", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "修正案を作成", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByText("古い結果 · 再レビューしてください", { exact: false }),
  ).toBeVisible();
});

import { projectJourney } from "./project-journey";
test("shared taste → two projects → isolated change → selective update → independent exports", async ({
  page,
}) => {
  test.setTimeout(120000);
  await projectJourney(page);
});

test("late saves and stale drafts cannot overwrite the next project's screen", async ({
  page,
}) => {
  const create = async (name: string) =>
    (
      await (
        await page.request.post("/api/projects", {
          data: { brief: { name }, useTaste: false },
        })
      ).json()
    ).id as string;
  const a = await create("Delayed A"),
    b = await create("Delayed B");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let received!: () => void;
  const started = new Promise<void>((r) => (received = r));
  await page.route(`**/api/projects/${a}/foundation/save`, async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto(`/projects/${a}/foundation`);
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#112233");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await started;
  await page
    .locator(".global-navigation")
    .getByRole("link", { name: "プロジェクト", exact: true })
    .click();
  await page
    .locator(".project-list article")
    .filter({
      has: page.getByRole("heading", { name: "Delayed B", exact: true }),
    })
    .getByRole("link", { name: "再開", exact: true })
    .click();
  await page
    .locator(".project-steps")
    .getByRole("link", { name: "foundation", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("textbox", { name: "accent", exact: true }),
  ).toHaveValue("#65764d");
  await expect(page.getByText(/確定履歴（revision 1/)).toBeVisible();
  // Advance B outside the mounted editor, then submit its old draft.
  const current = await (
    await page.request.get(`/api/projects/${b}/foundation`)
  ).json();
  await page.request.post(`/api/projects/${b}/foundation/save`, {
    data: {
      baseRevision: 1,
      design: { ...current.current.design, accent: "#445566" },
      reason: "another tab",
      requestId: crypto.randomUUID(),
    },
  });
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#778899");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "設定が更新されています" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "accent", exact: true }),
  ).toHaveValue("#778899");
  expect(
    (await (await page.request.get(`/api/projects/${b}/foundation`)).json())
      .current.design.accent,
  ).toBe("#445566");
});
