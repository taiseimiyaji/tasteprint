import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { initialState } from "../src/client/state";

let session = "";
test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/references/pair", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: { code: "e2e-pair-code" },
  });
  expect(response.ok()).toBe(true);
  session = response.headers()["set-cookie"].split(";")[0].split("=")[1];
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
  await page.goto("/");
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
  await expect(page.locator(".sample-app")).toHaveCSS(
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
  await expect(page.locator(".sample-app")).toHaveCSS("border-radius", "2px");
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
  expect((await download).suggestedFilename()).toBe("DESIGN.md");
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
  await page.goto("/inspiration");
  await page.getByRole("button", { name: "以前の参考を取り込む" }).click();
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
  await page.getByRole("link", { name: "好みを見比べる" }).click();
  await page.getByRole("button", { name: "A 余白で呼吸をつくる" }).click();
  await expect(page.getByText("1 answered")).toBeVisible();
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await expect(page.getByText("2 answered")).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 answered")).toBeVisible();
});

test("preview search, form, dialog, and narrow layout are usable", async ({
  page,
}) => {
  await page.goto("/preview");
  await page.getByRole("textbox", { name: "Search projects" }).fill("Brand");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved in preview" }),
  ).toBeVisible();
  await page.goto("/components");
  await page.getByRole("button", { name: "Dialog", exact: true }).click();
  await page.getByRole("button", { name: "Open dialog" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/foundation");
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
    await page.goto(`/${route}`);
    await expect(page.locator("h1")).toBeVisible();
  }
  await page.goto("/foundation");
  await page.screenshot({
    path: "test-results/foundation-desktop.png",
    fullPage: true,
  });
});
