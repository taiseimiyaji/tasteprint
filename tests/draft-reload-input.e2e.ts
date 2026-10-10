import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function navigate(page: Page, width: number, name: string) {
  if (width === 390)
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.locator("nav").getByRole("link", { name, exact: true }).click();
}

for (const width of [1440, 390])
  for (const surface of ["foundation", "patterns", "preview"] as const)
    test(`explicit valid draft reread resets obsolete invalid ${surface} state and preserves failed recovery at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const create = await page.request.post("/api/projects", {
        data: {
          brief: { name: `Draft reread ${surface} ${width}` },
          useTaste: false,
        },
      });
      expect(create.ok()).toBe(true);
      const p = await create.json();
      const base = `/api/projects/${p.id}`;
      const before = await (await page.request.get(base)).json();
      const editor = surface === "preview" ? "foundation" : surface;
      const field = (target: Page) =>
        editor === "foundation"
          ? target.getByRole("textbox", { name: "accent", exact: true })
          : target.getByRole("spinbutton", { name: "余白 (px)", exact: true });
      const valueOf = (design: any) =>
        editor === "foundation" ? design.accent : design.patterns.ListPage.gap;
      const invalid = editor === "foundation" ? "invalid-color" : "";
      const key = `tasteprint.scope.${p.id}.draft.v1`;
      await page.goto(`/projects/${p.id}/${editor}`);
      await expect(field(page)).toBeEnabled();
      await field(page).fill(invalid);
      await expect(field(page)).toHaveAttribute("aria-invalid", "true");
      if (surface === "preview") await navigate(page, width, "Preview");
      const second = await context.newPage();
      await second.setViewportSize({ width, height: 1050 });
      await second.goto(`/projects/${p.id}/${editor}`);
      await expect(field(second)).toBeEnabled();
      await field(second).fill(editor === "foundation" ? "#445566" : "37");
      const conflict = page
        .getByRole("alert")
        .filter({ hasText: "設計の下書きが別タブ・別画面で変更されています" });
      const reread = page.getByRole("button", {
        name: "設計の下書きを再読込",
        exact: true,
      });
      const save = page.getByRole("button", {
        name: "変更を保存",
        exact: true,
      });
      await expect(conflict).toBeVisible();
      const stored = await second.evaluate(
        (key) => localStorage.getItem(key),
        key,
      );
      expect(stored).not.toBeNull();

      // Both a storage read exception and invalid decoded shape leave local
      // input and its validation state intact, rather than reporting success.
      await page.evaluate((key) => {
        const original = Storage.prototype.getItem;
        (window as any).restoreDraftRead = () => {
          Storage.prototype.getItem = original;
        };
        Storage.prototype.getItem = function (name) {
          if (this === localStorage && name === key)
            throw new Error("reread test failure");
          return original.call(this, name);
        };
      }, key);
      await reread.click();
      await expect(conflict).toBeVisible();
      await expect(save).toBeDisabled();
      if (surface !== "preview") {
        await expect(field(page)).toHaveValue(invalid);
        await expect(field(page)).toHaveAttribute("aria-invalid", "true");
      }
      await page.evaluate(() => (window as any).restoreDraftRead());
      await second.evaluate(
        (key) => localStorage.setItem(key, JSON.stringify({ malformed: true })),
        key,
      );
      await reread.click();
      await expect(conflict).toBeVisible();
      await expect(save).toBeDisabled();
      if (surface !== "preview") await expect(field(page)).toHaveValue(invalid);
      await second.evaluate(
        ({ key, stored }) => localStorage.setItem(key, stored!),
        { key, stored },
      );

      // Explicit replacement retains this screen's input, including invalid raw
      // text; it is a different action from adopting the other tab's draft.
      await page
        .getByRole("button", {
          name: "設計の下書きを表示中の内容で置き換える",
          exact: true,
        })
        .click();
      await expect(conflict).toHaveCount(0);
      await expect(save).toBeDisabled();
      if (surface !== "preview") {
        await expect(field(page)).toBeEnabled();
        await expect(field(page)).toHaveValue(invalid);
        await expect(field(page)).toHaveAttribute("aria-invalid", "true");
      }
      await expect(
        second.getByRole("button", {
          name: "設計の下書きを再読込",
          exact: true,
        }),
      ).toBeVisible();
      await second
        .getByRole("button", { name: "設計の下書きを再読込", exact: true })
        .click();
      await expect(field(second)).toBeEnabled();
      const recovered = editor === "foundation" ? "#667788" : "42";
      await field(second).fill(recovered);
      await expect(conflict).toBeVisible();
      await reread.click();
      await expect(conflict).toHaveCount(0);
      await expect(save).toBeEnabled();
      if (surface === "preview") await navigate(page, width, "Foundation");
      await expect(field(page)).toHaveValue(recovered);
      await expect(field(page)).toHaveAttribute("aria-invalid", "false");
      expect(await (await page.request.get(base)).json()).toEqual(before);
      expect(
        String(
          valueOf(
            (
              await page.evaluate(
                (key) => JSON.parse(localStorage.getItem(key)!),
                key,
              )
            ).design,
          ),
        ),
      ).toBe(recovered);
      await second.close();

      // Fresh manual edits and Undo operate on the recovered draft. Saving and
      // JSON export must agree with the valid input, and reopening stays clean.
      await field(page).fill(editor === "foundation" ? "#abcdef" : "43");
      await page.getByRole("button", { name: "元に戻す", exact: true }).click();
      await expect(field(page)).toHaveValue(recovered);
      await expect(field(page)).toHaveAttribute("aria-invalid", "false");
      const update = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${base}/foundation/save` &&
          r.request().method() === "POST",
      );
      await save.click();
      const response = await update;
      expect(response.ok()).toBe(true);
      await response.finished();
      await expect(save).toBeDisabled();
      const accepted = await (await page.request.get(base)).json();
      expect(accepted.current.revision).toBe(2);
      expect(String(valueOf(accepted.current.design))).toBe(recovered);
      await navigate(page, width, "Export");
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const file = await download;
      const exported = JSON.parse(await readFile((await file.path())!, "utf8"));
      expect(exported.projectId).toBe(p.id);
      expect(exported.revision).toBe(2);
      expect(String(valueOf(exported.design))).toBe(recovered);
      await page.goto(`/projects/${p.id}/${editor}`);
      await expect(field(page)).toHaveValue(recovered);
      await expect(field(page)).toHaveAttribute("aria-invalid", "false");
      await expect(save).toBeDisabled();
      expect(
        (
          await (await page.request.get(`${base}/foundation`)).json()
        ).history.map((r: any) => r.revision),
      ).toEqual([1, 2]);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
      expect(errors).toEqual([]);
    });
