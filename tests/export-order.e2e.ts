import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
for (const width of [1440, 390])
  for (const reversed of [false, true])
    test(`Export insertion order survives ${reversed ? "reversed" : "equal"} timestamps, reuse and GET failure at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const name = `Export order ${width} ${reversed ? "reversed" : "equal"}`;
      const p = await (
        await page.request.post("/api/projects", {
          data: {
            brief: { name },
            useTaste: false,
          },
        })
      ).json();
      const base = `/api/projects/${p.id}`;
      let fail = true;
      const time = "2026-10-04T20:16:18.572Z";
      await page.route(`**${base}/exports`, async (route) => {
        if (fail && route.request().method() === "GET")
          return route.fulfill({
            status: 503,
            json: { message: "Export order recovery probe" },
          });
        const response = await route.fetch();
        const data = await response.json();
        const stamp = (r: any) => ({
          ...r,
          createdAt:
            reversed && r.revision === 2 ? "2025-10-04T20:16:18.572Z" : time,
        });
        const changed = Array.isArray(data) ? data.map(stamp) : stamp(data);
        if (route.request().method() === "POST") fail = true;
        await route.fulfill({ response, json: changed });
      });
      const foundationRead = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${base}/foundation` &&
          r.request().method() === "GET",
      );
      await page.goto(`/projects/${p.id}/export`);
      await (await foundationRead).finished();
      await page.evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          ),
      );
      await expect(
        page.getByRole("button", { name: "Export履歴を再取得", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByText(
          "このプロジェクトの確定 r1 を出力します。未保存の編集は含みません。",
        ),
      ).toBeVisible();
      const saved = await (await page.request.get(base)).json();
      const next = await page.request.post(base, {
        data: {
          baseRevision: 1,
          brief: saved.current.snapshot.brief,
          policies: [],
        },
      });
      expect(next.ok()).toBe(true);
      const a = await (
        await page.request.post(`${base}/exports`, {
          data: { baseRevision: 1 },
        })
      ).json();
      const b = await (
        await page.request.post(`${base}/exports`, {
          data: { baseRevision: 2 },
        })
      ).json();
      fail = false;
      await page
        .getByRole("button", { name: "Export履歴を再取得", exact: true })
        .click();
      await expect(
        page.getByText(
          "このプロジェクトの確定 r1 を出力します。未保存の編集は含みません。",
        ),
      ).toBeVisible();
      const rows = page
        .locator("section")
        .filter({
          has: page.getByRole("heading", { name: "Export履歴", exact: true }),
        })
        .locator("article");
      await expect(rows).toHaveCount(2);
      await expect(rows.first().getByRole("heading")).toContainText("r2 ·");
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const file = await download;
      const downloaded = JSON.parse(
        await readFile((await file.path())!, "utf8"),
      );
      expect(downloaded.revision).toBe(1);
      expect(downloaded.projectId).toBe(p.id);
      await expect(page.getByRole("alert")).toContainText(
        "Export order recovery probe",
      );
      await expect(rows.first().getByRole("heading")).toContainText("r2 ·");
      const canonical = await (
        await page.request.get(`${base}/exports`)
      ).json();
      expect(canonical[0].id).toBe(b.id);
      const dir = "../evidence/export-order-ui";
      mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: `${dir}/history-${width}-${reversed ? "reversed" : "equal"}.png`,
        fullPage: false,
      });
      expect(
        (await (await page.request.get(base)).json()).current.revision,
      ).toBe(2);
      await page.route("**/api/projects", async (route) =>
        fail
          ? route.fulfill({
              status: 503,
              json: { message: "Project list recovery probe" },
            })
          : route.continue(),
      );
      if (width === 390)
        await page
          .getByRole("button", { name: "メニュー", exact: true })
          .click();
      await page
        .locator("nav")
        .getByRole("link", { name: "プロジェクト", exact: true })
        .click();
      const card = page.locator(".project-list article").filter({
        has: page.getByRole("heading", {
          name,
          exact: true,
        }),
      });
      await expect(
        card.getByRole("link", { name: "最新Export r2", exact: true }),
      ).toBeVisible();
      fail = false;
      await page.reload();
      await expect(
        card.getByRole("link", { name: "最新Export r2", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      writeFileSync(
        `${dir}/verified-${width}-${reversed ? "reversed" : "equal"}.json`,
        JSON.stringify(
          {
            source:
              "real saved exports/downloads; controlled timestamp DTO (natural equal-time HTTP reproduction and reversed-clock regression); cached r1 editor retained across external r2 save; subsequent GET503",
            viewportWidth: width,
            clockFixture: reversed ? "reversed" : "equal",
            projectId: p.id,
            canonicalLatest: b.id,
            oldReusedId: a.id,
            uiFirstRevision: 2,
            canonicalFirstRevision: 2,
            realCodexCalls: (
              await (await page.request.get("/api/health")).json()
            ).codexCalls,
          },
          null,
          2,
        ) + "\n",
      );
    });
