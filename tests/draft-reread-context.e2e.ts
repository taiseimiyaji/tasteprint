import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const width of [1440, 390])
  for (const surface of ["foundation", "preview"] as const)
    test(`successful ${surface} draft reread replaces old candidate and Undo context while failed recovery retains it at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const created = await page.request.post("/api/projects", {
        data: {
          brief: { name: `Reread context ${surface} ${width}` },
          useTaste: false,
        },
      });
      expect(created.ok()).toBe(true);
      const p = await created.json(),
        base = `/api/projects/${p.id}`;
      const before = await (await page.request.get(base)).json();
      const key = `tasteprint.scope.${p.id}.draft.v1`;
      const radius = (target: Page) =>
        target.getByRole("spinbutton", { name: "radius", exact: true });
      const undo = page.getByRole("button", { name: "元に戻す", exact: true });
      const adopt = page.getByRole("button", { name: "採用する", exact: true });
      const preview = page.frameLocator("iframe").locator(".sample-app");
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
      await page.goto(`/projects/${p.id}/foundation`);
      await page.getByRole("tab", { name: "Radius", exact: true }).click();
      await radius(page).fill("14");
      await radius(page).fill("6");
      await expect(undo).toBeEnabled();
      await chat(true);
      await page
        .getByRole("button", { name: "角丸をもう少し弱くしたい", exact: true })
        .click();
      await page.getByRole("button", { name: "候補 2", exact: true }).click();
      await chat(false);
      await expect(preview).toHaveCSS("border-radius", "2px");
      const conversations = await (
        await page.request.get(`${base}/conversations`)
      ).json();
      const promptKey = `tasteprint.${p.id}.prompt`;
      const prompt = await page.evaluate(
        (key) => localStorage.getItem(key),
        promptKey,
      );
      expect(prompt).toBe("角丸をもう少し弱くしたい");
      if (surface === "preview") await nav("Preview");
      const second = await context.newPage();
      await second.goto(`/projects/${p.id}/foundation`);
      await second.getByRole("tab", { name: "Radius", exact: true }).click();
      await radius(second).fill("10");
      const reread = page.getByRole("button", {
        name: "設計の下書きを再読込",
        exact: true,
      });
      await expect(reread).toBeVisible();
      const stored = await second.evaluate(
        (key) => localStorage.getItem(key),
        key,
      );
      expect(stored).not.toBeNull();

      // A failed read/decode must not discard the edit session we are retaining.
      await page.evaluate((key) => {
        const original = Storage.prototype.getItem;
        (window as any).restoreDraftRead = () => {
          Storage.prototype.getItem = original;
        };
        Storage.prototype.getItem = function (name) {
          if (this === localStorage && name === key)
            throw new Error("reread failure");
          return original.call(this, name);
        };
      }, key);
      await reread.click();
      await expect(reread).toBeVisible();
      await expect(preview).toHaveCSS("border-radius", "2px");
      await page.evaluate(() => (window as any).restoreDraftRead());
      await second.evaluate(
        (key) => localStorage.setItem(key, JSON.stringify({ malformed: true })),
        key,
      );
      await reread.click();
      await expect(reread).toBeVisible();
      await expect(preview).toHaveCSS("border-radius", "2px");
      await second.evaluate(
        ({ key, stored }) => localStorage.setItem(key, stored!),
        { key, stored },
      );

      // Explicit replacement keeps this screen's draft, candidate and Undo.
      await page
        .getByRole("button", {
          name: "設計の下書きを表示中の内容で置き換える",
          exact: true,
        })
        .click();
      await expect(reread).toHaveCount(0);
      await expect(adopt).toBeEnabled();
      await expect(undo).toBeEnabled();
      await expect(preview).toHaveCSS("border-radius", "2px");
      if (surface === "foundation") await expect(radius(page)).toHaveValue("6");
      await expect(
        second.getByRole("button", {
          name: "設計の下書きを再読込",
          exact: true,
        }),
      ).toBeVisible();
      await second
        .getByRole("button", { name: "設計の下書きを再読込", exact: true })
        .click();
      await radius(second).fill("11");
      await expect(reread).toBeVisible();

      // Only successful adoption of the other tab's draft starts fresh context.
      await reread.click();
      await expect(reread).toHaveCount(0);
      await expect(adopt).toHaveCount(0);
      await expect(undo).toBeDisabled();
      await expect(preview).toHaveCSS("border-radius", "11px");
      expect(await (await page.request.get(base)).json()).toEqual(before);
      expect(
        await (await page.request.get(`${base}/conversations`)).json(),
      ).toEqual(conversations);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), promptKey),
      ).toBe(prompt);
      expect(
        (
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)!),
            key,
          )
        ).design.radius,
      ).toBe(11);
      await second.close();
      if (surface === "preview") await nav("Foundation");
      await expect(radius(page)).toHaveValue("11");
      await radius(page).fill("13");
      await expect(undo).toBeEnabled();
      await undo.click();
      await expect(radius(page)).toHaveValue("11");
      await expect(undo).toBeDisabled();
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${base}/foundation/save` &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      expect((await response).ok()).toBe(true);
      await expect(
        page.getByRole("button", { name: "変更を保存", exact: true }),
      ).toBeDisabled();
      const saved = await (await page.request.get(base)).json();
      expect(saved.current.revision).toBe(2);
      expect(saved.current.design.radius).toBe(11);
      await nav("Export");
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const exported = JSON.parse(
        await readFile((await (await download).path())!, "utf8"),
      );
      expect(exported.projectId).toBe(p.id);
      expect(exported.revision).toBe(2);
      expect(exported.design.radius).toBe(11);
      await page.goto(`/projects/${p.id}/foundation`);
      await page.getByRole("tab", { name: "Radius", exact: true }).click();
      await expect(radius(page)).toHaveValue("11");
      await expect(undo).toBeDisabled();
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
