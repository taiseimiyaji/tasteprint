import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const [width, editor] of [
  [1440, "foundation"],
  [390, "patterns"],
] as const)
  for (const action of ["undo", "apply", "review"] as const)
    test(`${editor} ${action} adopts fresh validation without a mounted editor at ${width}`, async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.setViewportSize({ width, height: 1050 });
      const created = await page.request.post("/api/projects", {
        data: {
          brief: { name: `Lifecycle ${editor} ${action} ${width}` },
          useTaste: false,
        },
      });
      expect(created.ok()).toBe(true);
      const project = await created.json(),
        base = `/api/projects/${project.id}`;
      const before = await (await page.request.get(base)).json();
      const key = `tasteprint.scope.${project.id}.draft.v1`;
      const nav = async (name: string) => {
        if (width === 390)
          await page
            .getByRole("button", { name: "メニュー", exact: true })
            .click();
        await page
          .locator("nav")
          .getByRole("link", { name, exact: true })
          .click();
      };
      const chat = async (open: boolean) => {
        if (width === 390)
          await page
            .getByRole("button", {
              name: open ? "対話パネルを切り替え" : "対話パネルを閉じる",
              exact: true,
            })
            .click();
      };
      await page.goto(`/projects/${project.id}/${editor}`);
      const input =
        editor === "foundation"
          ? page.getByRole("textbox", { name: "accent", exact: true })
          : page.getByRole("spinbutton", { name: "余白 (px)", exact: true });
      if (action === "undo") {
        await input.fill(editor === "foundation" ? "#445566" : "25");
        await input.fill(
          editor === "foundation" ? before.current.design.accent : "16",
        );
      }
      if (action === "apply") {
        await chat(true);
        await page
          .getByRole("button", {
            name: "角丸をもう少し弱くしたい",
            exact: true,
          })
          .click();
        await page.getByRole("button", { name: "候補 2", exact: true }).click();
        await chat(false);
      }
      await input.fill(editor === "foundation" ? "invalid-color" : "");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      if (action === "review") {
        await nav("AI Review");
        await page
          .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
          .click();
        await expect(
          page.getByText("要判断の指摘数:", { exact: false }),
        ).toBeVisible({ timeout: 90000 });
        await page
          .getByRole("button", { name: "修正案を作成", exact: true })
          .click();
        await page
          .getByRole("button", { name: "仮Preview:", exact: false })
          .first()
          .click();
      } else await nav("Preview");
      let posts = 0;
      const rejectFirst =
        (editor === "foundation" && action === "apply") ||
        (editor === "patterns" && action === "review");
      if (action !== "undo")
        await page.route(`**${base}/foundation/apply`, (route) => {
          if (rejectFirst && ++posts === 1)
            return route.fulfill({
              status: 500,
              json: { message: "EDITOR_VALIDATION_REJECTED" },
            });
          return route.continue();
        });
      if (action === "undo") {
        await page
          .getByRole("button", { name: "元に戻す", exact: true })
          .click();
      } else {
        const adopt = page.getByRole("button", {
          name: action === "review" ? "まとめて適用" : "採用する",
          exact: true,
        });
        if (rejectFirst) {
          const failed = page.waitForResponse(
            (r) =>
              new URL(r.url()).pathname === `${base}/foundation/apply` &&
              r.request().method() === "POST",
          );
          await adopt.click();
          expect((await failed).status()).toBe(500);
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "EDITOR_VALIDATION_REJECTED" }),
          ).toBeVisible();
          await expect(adopt).toBeEnabled();
          expect(await (await page.request.get(base)).json()).toEqual(before);
          expect(
            (
              await page.evaluate(
                (key) => JSON.parse(localStorage.getItem(key)!),
                key,
              )
            ).design,
          ).toEqual(before.current.design);
          if (action === "apply")
            await expect(page.locator(".editor-actions")).toContainText(
              "入力欄のエラーを修正すると保存できます",
            );
        }
        const response = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === `${base}/foundation/apply` &&
            r.request().method() === "POST",
        );
        await adopt.click();
        const result = await response;
        expect(result.ok()).toBe(true);
        await result.finished();
        if (action === "review") await nav("Preview");
      }
      const status = page.locator(".editor-actions");
      await expect(status).not.toContainText("入力の確認が必要");
      await expect(status).not.toContainText(
        "入力欄のエラーを修正すると保存できます",
      );
      const draft = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        key,
      );
      const expectedDesign =
        action === "undo"
          ? draft.design
          : (await (await page.request.get(base)).json()).current.design;
      const preview = page.frameLocator("iframe");
      if (action === "undo") {
        expect(await (await page.request.get(base)).json()).toEqual(before);
        expect(
          editor === "foundation"
            ? expectedDesign.accent
            : expectedDesign.patterns.ListPage.gap,
        ).toBe(editor === "foundation" ? "#445566" : 25);
        await expect(status).toContainText("下書き・未保存 · 設計 r1");
        const save = page.getByRole("button", {
          name: "変更を保存",
          exact: true,
        });
        await expect(save).toBeEnabled();
        if (editor === "foundation")
          await expect(preview.locator(".sample-app")).toHaveCSS(
            "--preview-accent",
            "#445566",
          );
        else
          await expect(preview.locator('[data-pattern="ListPage"]')).toHaveCSS(
            "gap",
            "25px",
          );
        const response = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === `${base}/foundation/save` &&
            r.request().method() === "POST",
        );
        await save.click();
        expect((await response).ok()).toBe(true);
      } else {
        expect(expectedDesign.radius).toBe(action === "apply" ? 2 : 4);
        expect(draft.baseRevision).toBe(2);
        expect(draft.design).toEqual(expectedDesign);
        await expect(preview.locator(".sample-app")).toHaveCSS(
          "border-radius",
          `${expectedDesign.radius}px`,
        );
      }
      await expect(status).toContainText("保存済み · 設計 r2");
      await expect(
        page.getByRole("button", {
          name: "未保存の変更を取り消す",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "元に戻す", exact: true }),
      ).toBeDisabled();
      const saved = await (await page.request.get(base)).json();
      expect(saved.current.revision).toBe(2);
      expect(saved.current.design).toEqual(expectedDesign);
      expect(
        (
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)!),
            key,
          )
        ).design,
      ).toEqual(expectedDesign);
      await nav("Export");
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const exported = JSON.parse(
        await readFile((await (await download).path())!, "utf8"),
      );
      expect(exported.projectId).toBe(project.id);
      expect(exported.revision).toBe(2);
      expect(exported.design).toEqual(expectedDesign);
      await page.goto(`/projects/${project.id}/${editor}`);
      await expect(input).toHaveAttribute("aria-invalid", "false");
      await expect(status).toContainText("保存済み · 設計 r2");
      await expect(
        page.getByRole("button", { name: "変更を保存", exact: true }),
      ).toBeDisabled();

      // Representative cancel and restore controls exercise the same adoption
      // reset, while ordinary category/pattern switches retain independent errors.
      if (action === "undo") {
        await input.fill(editor === "foundation" ? "invalid-again" : "");
        await expect(input).toHaveAttribute("aria-invalid", "true");
        await nav("Preview");
        await expect(status).toContainText("入力の確認が必要");
        await page
          .getByRole("button", { name: "未保存の変更を取り消す", exact: true })
          .click();
        await expect(status).toContainText("保存済み · 設計 r2");
        expect((await (await page.request.get(base)).json()).current).toEqual(
          saved.current,
        );
        await nav(editor === "foundation" ? "Foundation" : "Patterns");
        await input.fill(
          editor === "foundation" ? "invalid-before-restore" : "",
        );
        await expect(input).toHaveAttribute("aria-invalid", "true");
        await page.getByText(/確定履歴（revision 2/).click();
        const restore = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === `${base}/foundation/restore` &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "r1を復元", exact: true })
          .click();
        expect((await restore).ok()).toBe(true);
        await expect(status).toContainText("保存済み · 設計 r3");
        await expect(input).toHaveAttribute("aria-invalid", "false");
        expect(
          (await (await page.request.get(base)).json()).current.design,
        ).toEqual(before.current.design);
      }
      const history = (
        await (await page.request.get(`${base}/foundation`)).json()
      ).history;
      expect(history.map((r: any) => r.revision)).toEqual(
        action === "undo" ? [1, 2, 3] : [1, 2],
      );
      expect(history[0].design).toEqual(before.current.design);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    });
