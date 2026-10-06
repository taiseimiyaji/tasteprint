import { test, expect } from "@playwright/test";
import sharp from "sharp";
import type { SavedReference } from "../src/domain/reference";

for (const width of [1440, 390])
  for (const kind of ["URL", "image"] as const)
    test(`Project ${width} delayed initial ${kind} reply preserves a normally deleted Reference`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const project = await (
        await page.request.post("/api/projects", {
          data: {
            brief: { name: `Initial Reference deletion ${kind} ${width}` },
            useTaste: false,
          },
        })
      ).json();
      const base = `/api/projects/${project.id}/references`;
      const other: SavedReference = await (
        await page.request.post(base, {
          data: {
            name: `Survivor ${kind} ${width}`,
            url: "https://example.com/e2e-pending",
            selections: [{ aspect: "Typography", intent: "reference" }],
            likes: "",
            dislikes: "",
          },
        })
      ).json();
      const job = await (
        await page.request.post(`${base}/${other.id}/jobs`, {
          data: {
            version: other.version,
            type: "capture",
            key: crypto.randomUUID(),
          },
        })
      ).json();
      const name =
        kind === "URL"
          ? `late-${crypto.randomUUID()}.example`
          : "late-image.png";
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const started = new Promise<void>((r) => (entered = r));
      let receipt!: SavedReference,
        failRead = false,
        posts = 0,
        deletes = 0;
      await page.route(`**${base}`, async (route) => {
        if (route.request().method() === "GET" && failRead)
          return route.fulfill({
            status: 503,
            json: { message: "List read failed" },
          });
        if (route.request().method() !== "POST") return route.continue();
        posts++;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        receipt = await response.json();
        entered();
        await gate;
        await route.fulfill({ response });
      });
      let followupDone!: () => void;
      const followup = new Promise<void>((r) => (followupDone = r));
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === `${base}/${receipt?.id}` &&
          request.method() === "DELETE"
        )
          deletes++;
      });
      page.on("response", (response) => {
        if (
          new URL(response.url()).pathname ===
          `${base}/${receipt?.id}/${kind === "URL" ? "jobs" : "image"}`
        ) {
          expect(response.status()).toBe(404);
          followupDone();
        }
      });
      await page.goto(`/projects/${project.id}/inspiration`);
      if (kind === "URL") {
        await page
          .getByRole("textbox", { name: "Reference URL", exact: true })
          .fill(`https://${name}/`);
        await page
          .getByRole("button", { name: "参考を追加", exact: true })
          .click();
      } else {
        await page.getByLabel("画像を追加", { exact: true }).setInputFiles({
          name,
          mimeType: "image/png",
          buffer: await sharp({
            create: { width: 20, height: 20, channels: 3, background: "white" },
          })
            .png()
            .toBuffer(),
        });
      }
      await started;
      const card = page
        .locator(".reference-card")
        .filter({
          has: page.getByRole("heading", { name, level: 3, exact: true }),
        });
      const otherCard = page
        .locator(".reference-card")
        .filter({
          has: page.getByRole("heading", {
            name: other.name,
            level: 3,
            exact: true,
          }),
        });
      const key = `tasteprint.${project.id}.reference.${receipt.id}`;
      const navigate = async (step: string) => {
        const link = page
          .getByRole("navigation", { name: "プロジェクトの設計", exact: true })
          .getByRole("link", { name: step, exact: true });
        if (!(await link.isVisible()))
          await page
            .getByRole("button", { name: "メニュー", exact: true })
            .click();
        await link.click();
        await expect(page).toHaveURL(
          `/projects/${project.id}/${step.toLowerCase()}`,
        );
      };
      try {
        // The first receipt is pending; a genuine collection read reveals its committed ID.
        await expect(card).toBeVisible({ timeout: 10000 });
        await navigate("Foundation");
        await navigate("Inspiration");
        await card
          .getByRole("textbox", { name: "好きな点", exact: true })
          .fill("Keep my deleted Reference draft");
        await expect
          .poll(() =>
            page.evaluate(
              (k) => JSON.parse(localStorage.getItem(k)!).likes,
              key,
            ),
          )
          .toBe("Keep my deleted Reference draft");
        const draft = await page.evaluate((k) => localStorage.getItem(k), key);
        await card.getByRole("button", { name: "削除", exact: true }).click();
        await expect(card).toHaveCount(0);
        const before = await (await page.request.get(base)).json();
        expect(
          before.references.some((r: SavedReference) => r.id === receipt.id),
        ).toBe(false);
        failRead = true;
        release();
        await followup;
        // Trigger a read explicitly so the retained client state is also tested with a 503.
        await navigate("Foundation");
        await navigate("Inspiration");
        await expect(
          page.getByText(
            "参考一覧の読み込みに失敗しました。表示中の内容と入力は保持しています。List read failed",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(card).toHaveCount(0);
        await expect(otherCard).toBeVisible();
        expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
          draft,
        );
        const after = await (await page.request.get(base)).json();
        expect(
          after.references.some((r: SavedReference) => r.id === receipt.id),
        ).toBe(false);
        expect(
          after.references.some((r: SavedReference) => r.id === other.id),
        ).toBe(true);
        expect(after.jobs.some((j: { id: string }) => j.id === job.id)).toBe(
          true,
        );
        expect(posts).toBe(1);
        expect(deletes).toBe(1);
        expect(
          (await (await page.request.get("/api/health")).json()).codexCalls,
        ).toBe(0);
        failRead = false;
        await page
          .getByRole("button", { name: "一覧を再取得", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "一覧を再取得", exact: true }),
        ).toHaveCount(0);
        await expect(card).toHaveCount(0);
        await page.reload();
        await expect(otherCard).toBeVisible();
        await expect(card).toHaveCount(0);
        expect(posts).toBe(1);
        expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(
          draft,
        );
      } finally {
        release();
      }
    });
