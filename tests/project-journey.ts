import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
export async function projectJourney(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/profile");
  await page.getByLabel("density-0", { exact: true }).selectOption("b");
  await page.getByLabel("density-0 理由", { exact: true }).fill("一覧性を優先");
  await page.getByRole("button", { name: "原則を追加", exact: true }).click();
  const field = page.locator(".principle-fields").last();
  await field
    .getByLabel("原則", { exact: true })
    .fill("一覧は行と区切り線を優先");
  await field.getByLabel("理由", { exact: true }).fill("一覧性");
  await page
    .getByRole("button", { name: "共通の好みを保存", exact: true })
    .click();
  await expect(page.getByText("共通の好みを保存しました")).toBeVisible();
  const ids: string[] = [];
  for (const name of ["業務管理アプリ", "個人サイト"]) {
    await page.goto("/projects");
    await page.getByLabel("プロジェクト名", { exact: true }).fill(name);
    await page
      .getByLabel("用途", { exact: true })
      .fill(name === "個人サイト" ? "作品紹介" : "業務管理");
    await page
      .getByRole("button", { name: "プロジェクトを作成", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    ids.push(new URL(page.url()).pathname.split("/")[2]);
    await expect(
      page.getByText("一覧は行と区切り線を優先", { exact: false }).first(),
    ).toBeVisible();
  }
  const [a, b] = ids;
  await page.getByRole("button", { name: "原則を追加", exact: true }).click();
  await page
    .locator(".principle-fields")
    .getByLabel("原則", { exact: true })
    .fill("作品一覧はカードを使う");
  await page
    .locator(".principle-fields")
    .getByLabel("理由", { exact: true })
    .fill("作品の画像を見せる");
  await page
    .getByRole("button", { name: "概要・方針を保存", exact: true })
    .click();
  await expect(page.getByText("概要・設計方針 · 確定 r2")).toBeVisible();
  await page.goto(`/projects/${b}/foundation`);
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#224466");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.getByText(/確定履歴（revision 3/)).toBeVisible();
  // Preserve a draft across project switches, including a reload.
  await page
    .getByRole("textbox", { name: "accent", exact: true })
    .fill("#abcdef");
  await page.getByLabel("プロジェクト切り替え").selectOption(a);
  await page.waitForURL(`**/projects/${a}/overview`);
  await page.goto(`/projects/${a}/foundation`);
  await expect(
    page.getByRole("textbox", { name: "accent", exact: true }),
  ).not.toHaveValue("#224466");
  await page.getByLabel("プロジェクト切り替え").selectOption(b);
  await page.waitForURL(`**/projects/${b}/overview`);
  await page.goto(`/projects/${b}/foundation`);
  await expect(
    page.getByRole("textbox", { name: "accent", exact: true }),
  ).toHaveValue("#abcdef");
  await page
    .getByRole("button", { name: "未保存の変更を取り消す", exact: true })
    .click();
  await page.goto(`/projects/${a}/export`);
  const before = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const old = await before,
    oldContent = await readFile((await old.path())!, "utf8");
  await page.goto("/profile");
  await page.getByLabel("density-0", { exact: true }).selectOption("a");
  await page
    .getByRole("button", { name: "共通の好みを保存", exact: true })
    .click();
  await expect(page.getByText("共通の好みを保存しました")).toBeVisible();
  await page.goto(`/projects/${a}/overview`);
  await expect(
    page.getByText("共通の好みに更新があります · 差分を確認"),
  ).toBeVisible();
  await page.getByRole("button", { name: "差分を確認", exact: true }).click();
  await page
    .getByLabel("差分 answer:density-0", { exact: true })
    .selectOption("adopt");
  await page
    .getByRole("button", {
      name: "選択を確定して新revisionを作成",
      exact: true,
    })
    .click();
  await expect(page.getByText("概要・設計方針 · 確定 r2")).toBeVisible();
  await page.goto(`/projects/${a}/export`);
  const again = page.waitForEvent("download");
  await page
    .getByRole("link", { name: old.suggestedFilename(), exact: true })
    .click();
  expect(await readFile((await (await again).path())!, "utf8")).toBe(
    oldContent,
  );
  for (const id of [a, b]) {
    await page.goto(`/projects/${id}/export`);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    const output = await dl;
    expect(output.suggestedFilename()).toContain(id.slice(0, 8));
    const json = JSON.parse(await readFile((await output.path())!, "utf8"));
    expect(json.projectId).toBe(id);
    if (id === b) {
      expect(json.design.accent).toBe("#224466");
      expect(json.snapshot.taste.answers["density-0"]).toBe("b");
      expect(json.snapshot.policies[0].text).toBe("作品一覧はカードを使う");
    } else expect(json.snapshot.taste.answers["density-0"]).toBe("a");
  }
  await page.goto("/projects");
  const card = page
    .locator(".project-list article")
    .filter({
      has: page.getByRole("heading", { name: "個人サイト", exact: true }),
    });
  await card.getByRole("button", { name: "アーカイブ", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "アーカイブ解除", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "アーカイブ解除", exact: true })
    .click();
  await card.getByRole("link", { name: "再開", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "個人サイト", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/projects-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
}
