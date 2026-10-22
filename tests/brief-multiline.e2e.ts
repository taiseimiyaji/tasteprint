import { expect, test } from "@playwright/test";

test("multiline brief fields survive creation and Overview edits", async ({
  page,
}) => {
  const name = `Multiline brief ${crypto.randomUUID()}`;
  const fields = {
    用途: "第一段落: 背景と目的\n第二段落: 対象と条件",
    対象ユーザー: "チームA\nチームB",
    目指す印象: "落ち着き\n読みやすさ",
    避けたい印象: "密集\n強い装飾",
  };
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projects");
    await page
      .getByRole("button", { name: "新規プロジェクト", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("プロジェクト名", { exact: true }).fill(name);
    await dialog.getByText("用途などを追加（任意）", { exact: true }).click();
    for (const [label, value] of Object.entries(fields)) {
      const field = dialog.getByRole("textbox", { name: label, exact: true });
      await expect(field).toHaveJSProperty("tagName", "TEXTAREA");
      await field.fill(value);
      await expect(field).toHaveValue(value);
      await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(
        value,
      );
    }
    await dialog.getByLabel("共通の好みを使う", { exact: true }).uncheck();
    await dialog
      .getByRole("button", { name: "プロジェクトを作成", exact: true })
      .click();
    await page.waitForURL(/\/projects\/[^/]+\/overview/);
    const projectId = new URL(page.url()).pathname.split("/")[2];
    const created = await page.request.get(`/api/projects/${projectId}`);
    expect(created.ok()).toBe(true);
    expect((await created.json()).current.snapshot.brief).toMatchObject({
      purpose: fields.用途,
      audience: fields.対象ユーザー,
      desired: fields.目指す印象,
      avoid: fields.避けたい印象,
    });
    await page.reload();
    for (const [label, value] of Object.entries(fields))
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
    await expect(
      page.getByLabel("プロジェクト名", { exact: true }),
    ).toHaveJSProperty("tagName", "INPUT");
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);

    const revised = "第一段落: 更新\n第二段落: 確認\n第三段落: 保存";
    await page
      .getByRole("textbox", { name: "用途", exact: true })
      .fill(revised);
    await page
      .locator(".editor-actions")
      .getByRole("button", { name: "概要・方針を保存", exact: true })
      .click();
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r2",
    );
    const saved = await page.request.get(`/api/projects/${projectId}`);
    expect(saved.ok()).toBe(true);
    expect((await saved.json()).current.snapshot.brief.purpose).toBe(revised);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "用途", exact: true }),
    ).toHaveValue(revised);
    for (const [label, value] of Object.entries(fields).filter(
      ([label]) => label !== "用途",
    ))
      await expect(
        page.getByRole("textbox", { name: label, exact: true }),
      ).toHaveValue(value);
  } finally {
    const response = await page.request.get("/api/projects");
    if (response.ok()) {
      const project = (await response.json()).find(
        (candidate: { brief: { name: string } }) =>
          candidate.brief.name === name,
      );
      if (project) {
        const current = await page.request.get(`/api/projects/${project.id}`);
        if (current.ok())
          await page.request.post(`/api/projects/${project.id}/archive`, {
            data: {
              baseRevision: (await current.json()).current.revision,
              archived: true,
            },
          });
      }
    }
  }
});
