import { expect, test } from "@playwright/test";

for (const [step, width] of [
  ["overview", 390],
  ["foundation", 1440],
] as const)
  test(`archived ${step} keeps its draft but blocks save until restored at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const name = `Archived ${step} draft`;
    const created = await page.request.post("/api/projects", {
      data: { brief: { name }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const base = `/api/projects/${project.id}`;
    const path = `/projects/${project.id}/${step}`;
    const draftKey =
      step === "overview"
        ? `tasteprint.${project.id}.overview`
        : `tasteprint.scope.${project.id}.draft.v1`;
    const input = page.getByRole("textbox", {
      name: step === "overview" ? "用途" : "accent",
      exact: true,
    });
    const draft = step === "overview" ? "アーカイブ前の未保存用途" : "#335577";
    const save = page.getByRole("button", {
      name: step === "overview" ? "概要・方針を保存" : "変更を保存",
      exact: true,
    });
    const row = page.getByRole("article").filter({
      has: page.getByRole("heading", { name, exact: true }),
    });
    try {
      await page.goto(path);
      await input.fill(draft);
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), draftKey))
        .toContain(draft);
      await page.goto("/projects");
      await row.getByRole("button", { name: /をアーカイブ$/ }).click();
      await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
      await row.getByRole("link", { name: /を再開$/ }).click();
      if (step === "foundation") await page.goto(path);
      await expect(
        page.getByText("アーカイブ中 · 変更するには一覧から解除してください"),
      ).toBeVisible();
      await expect(input).toHaveValue(draft);
      await expect(page.locator(".editor-actions")).toContainText(
        "下書き・未保存 · 設計 r1",
      );
      await expect(page.locator(".editor-actions")).toContainText(
        "アーカイブ中です。一覧から解除してから保存してください。",
      );
      await expect(save).toBeDisabled();
      let writes = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request
            .url()
            .endsWith(step === "overview" ? base : `${base}/foundation/save`)
        )
          writes++;
      });
      await save.evaluate((button: HTMLButtonElement) => button.click());
      expect(writes).toBe(0);
      expect(
        (await (await page.request.get(base)).json()).current.revision,
      ).toBe(1);

      await page.goto("/projects");
      await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
      await row.getByRole("button", { name: /をアーカイブ解除$/ }).click();
      await page.goto(path);
      await expect(input).toHaveValue(draft);
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.locator(".editor-actions")).toContainText(
        "保存済み · 設計 r2",
      );
      const saved = (await (await page.request.get(base)).json()).current;
      expect(saved.revision).toBe(2);
      if (step === "overview") expect(saved.snapshot.brief.purpose).toBe(draft);
      else expect(saved.design.accent).toBe(draft);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    } finally {
      const current = await page.request.get(base);
      if (current.ok())
        await page.request.post(`${base}/archive`, {
          data: {
            baseRevision: (await current.json()).current.revision,
            archived: true,
          },
        });
    }
  });
