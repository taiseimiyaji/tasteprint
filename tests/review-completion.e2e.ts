import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const width of [1440, 390])
  for (const firstOutcome of ["success", "failure"] as const)
    test(`Review completion ${firstOutcome} preserves pending context and finishes like normal commit at ${width}`, async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.setViewportSize({ width, height: 1050 });
      const p = await (
        await page.request.post("/api/projects", {
          data: {
            brief: { name: `Review completion ${firstOutcome} ${width}` },
            useTaste: false,
          },
        })
      ).json();
      const base = `/api/projects/${p.id}`;
      const read = async () =>
        await (await page.request.get(`${base}/foundation`)).json();
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
      const preview = page.frameLocator("iframe").locator(".sample-app");
      const input = page.getByRole("spinbutton", {
        name: "radius",
        exact: true,
      });
      const undo = page.getByRole("button", { name: "元に戻す", exact: true });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/projects/${p.id}/foundation`);
      await page.getByRole("tab", { name: "Radius", exact: true }).click();
      await input.fill("14");
      await input.fill("6");
      await expect(undo).toBeEnabled();
      await chat(true);
      await page
        .getByRole("button", { name: "角丸をもう少し弱くしたい", exact: true })
        .click();
      await page.getByRole("button", { name: "候補 2", exact: true }).click();
      await chat(false);
      await expect(preview).toHaveCSS("border-radius", "2px");
      const conversationBefore = await (
        await page.request.get(`${base}/conversations`)
      ).json();
      await nav("AI Review");
      await page
        .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
        .click();
      await expect(
        page.getByText("要判断の指摘数:", { exact: false }),
      ).toBeVisible({ timeout: 90000 });
      const selectReviewCandidate = async () => {
        await page
          .getByRole("button", { name: "修正案を作成", exact: true })
          .click();
        await page
          .getByRole("button", { name: "仮Preview:", exact: false })
          .first()
          .click();
      };
      await selectReviewCandidate();
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => (entered = resolve));
      const held = new Promise<void>((resolve) => (release = resolve));
      let posts = 0;
      await page.route(`**${base}/foundation/apply`, async (route) => {
        if (++posts !== 1) return route.continue();
        entered();
        await held;
        if (firstOutcome === "failure")
          return route.fulfill({
            status: 500,
            json: { message: "REVIEW_COMPLETION_REJECTED" },
          });
        return route.continue();
      });
      try {
        const reply = page.waitForResponse(
          (r) =>
            r.url().endsWith(`${base}/foundation/apply`) &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "まとめて適用", exact: true })
          .click();
        await started;
        await nav("Foundation");
        await page.getByRole("tab", { name: "Radius", exact: true }).click();
        await expect(input).toHaveValue("6");
        await expect(input).toBeDisabled();
        await expect(preview).toHaveCSS("border-radius", "2px");
        await expect(
          page.getByRole("button", { name: "採用する", exact: true }),
        ).toBeDisabled();
        await expect(undo).toBeDisabled();
        expect((await read()).current.revision).toBe(1);
        release();
        expect((await reply).status()).toBe(
          firstOutcome === "failure" ? 500 : 200,
        );
        await expect(input).toBeEnabled();
        if (firstOutcome === "failure") {
          await expect(input).toHaveValue("6");
          await expect(preview).toHaveCSS("border-radius", "2px");
          await expect(
            page.getByRole("button", { name: "採用する", exact: true }),
          ).toBeEnabled();
          await expect(undo).toBeEnabled();
          expect((await read()).current.revision).toBe(1);
          await nav("AI Review");
          await selectReviewCandidate();
          await page
            .getByRole("button", { name: "まとめて適用", exact: true })
            .click();
          await expect(
            page.getByText("古い結果 · 再レビューしてください", {
              exact: false,
            }),
          ).toBeVisible();
          await nav("Foundation");
          await page.getByRole("tab", { name: "Radius", exact: true }).click();
        }
        await expect(input).toHaveValue("4");
        await expect(preview).toHaveCSS("border-radius", "4px");
        await expect(page.locator(".editor-actions")).toContainText(
          "保存済み · 設計 r2",
        );
        await expect(page.locator(".editor-actions")).not.toContainText(
          "仮Preview",
        );
        await expect(
          page.getByRole("button", { name: "採用する", exact: true }),
        ).toHaveCount(0);
        await expect(undo).toBeDisabled();
        await chat(true);
        await expect(
          page.getByRole("button", { name: "候補 1", exact: true }),
        ).toHaveCount(0);
        await chat(false);
        const committed = await read();
        expect(
          committed.history.map((r: { revision: number }) => r.revision),
        ).toEqual([1, 2]);
        expect(committed.current.design.radius).toBe(4);
        expect(
          await (await page.request.get(`${base}/conversations`)).json(),
        ).toEqual(conversationBefore);
        await expect
          .poll(() =>
            page.evaluate(
              (id) =>
                JSON.parse(
                  localStorage.getItem(`tasteprint.scope.${id}.draft.v1`)!,
                ),
              p.id,
            ),
          )
          .toMatchObject({ baseRevision: 2, design: { radius: 4 } });
        await input.fill("9");
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(input).toHaveValue("4");
        await expect(undo).toBeDisabled();
        await chat(true);
        await page
          .getByRole("button", {
            name: "角丸をもう少し弱くしたい",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", { name: "候補 1", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "候補 2", exact: true }).click();
        await chat(false);
        await expect(preview).toHaveCSS("border-radius", "2px");
        await page
          .getByRole("button", { name: "採用する", exact: true })
          .click();
        await expect(page.locator(".editor-actions")).toContainText(
          "保存済み · 設計 r3",
        );
        expect((await read()).current.design.radius).toBe(2);
        await nav("Export");
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: "JSON", exact: true }).click();
        const exported = JSON.parse(
          await readFile((await (await download).path())!, "utf8"),
        );
        expect(exported.revision).toBe(3);
        expect(exported.design.radius).toBe(2);
        expect(posts).toBe(firstOutcome === "failure" ? 3 : 2);
        expect(errors).toEqual([]);
        expect(
          (await (await page.request.get("/api/health")).json()).codexCalls,
        ).toBe(0);
      } finally {
        release();
      }
    });
