import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { initialState } from "../src/client/state";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const latest = (await (await request.get(base)).json()).references.find(
      (r: { id: string; version: number }) => r.id === id,
    );
    if (latest)
      expect(
        (
          await request.delete(`${base}/${id}`, {
            data: { version: latest.version },
          })
        ).ok(),
      ).toBe(true);
  }
});
for (const format of ["png", "jpeg", "webp"] as const)
  for (const width of [1440, 390])
    test(`legacy ${format} media type follows unchanged bytes at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const oldID = crypto.randomUUID(),
        id = createHash("sha256")
          .update(oldID)
          .digest("hex")
          .slice(0, 32)
          .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
      const bytes = await sharp({
        create: { width: 160, height: 90, channels: 3, background: "#345678" },
      })
        [format]()
        .toBuffer();
      const originalURI = `data:image/${format};base64,${bytes.toString("base64")}`;
      const payload = {
        ...initialState,
        references: [
          {
            id: oldID,
            name: `Legacy ${format} MIME probe`,
            url: `https://legacy-image.example/${oldID}`,
            aspects: ["Typography"],
            image: originalURI,
          },
        ],
      };
      const response = await page.request.post("/api/migration/browser", {
        data: payload,
      });
      expect(response.ok()).toBe(true);
      const imported = await response.json(),
        base = `/api/projects/${imported.projectId}/references`;
      const ref = (await (await page.request.get(base)).json()).references.find(
        (r: any) => r.id === id,
      );
      created.push({ base, id });
      const image = await page.request.get(
        `${base}/${id}/image?v=${ref.assetId}`,
      );
      expect(image.ok()).toBe(true);
      const body = await image.body();
      expect(body.equals(bytes)).toBe(true);
      const decoded = await sharp(body).metadata();
      expect(decoded).toMatchObject({ format, width: 160, height: 90 });
      expect(image.headers()["content-type"]).toBe(`image/${format}`);
      const foundation = (
        await (
          await page.request.get(
            `/api/projects/${imported.projectId}/foundation`,
          )
        ).json()
      ).current;
      const frozen = foundation.snapshot.references.find(
        (r: any) => r.id === id,
      );
      expect(frozen.image.startsWith(`data:image/${format};base64,`)).toBe(
        true,
      );
      expect(
        Buffer.from(frozen.image.split(",")[1], "base64").equals(bytes),
      ).toBe(true);
      await page.goto(`/projects/${imported.projectId}/inspiration`);
      const card = page.locator(".reference-card").filter({
        has: page.getByRole("heading", {
          name: `Legacy ${format} MIME probe`,
          level: 3,
          exact: true,
        }),
      });
      await expect(card.getByRole("img")).toBeVisible();
      expect(
        await card.getByRole("img").evaluate((img: HTMLImageElement) => ({
          w: img.naturalWidth,
          h: img.naturalHeight,
        })),
      ).toEqual({ w: 160, h: 90 });
      mkdirSync("../evidence/legacy-image-mime-ui", { recursive: true });
      await page.screenshot({
        path: `../evidence/legacy-image-mime-ui/${format}-${width}.png`,
        fullPage: true,
      });
      const oldFoundation = await (
        await page.request.get(`/api/projects/${imported.projectId}/foundation`)
      ).json();
      if (width === 390)
        await page
          .getByRole("button", { name: "メニュー", exact: true })
          .click();
      await page.getByRole("link", { name: "Foundation", exact: true }).click();
      await page
        .getByRole("textbox", { name: "accent", exact: true })
        .fill(
          oldFoundation.current.design.accent === "#112244"
            ? "#224466"
            : "#112244",
        );
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      await expect(page.locator(".editor-actions")).toContainText(
        `設計 r${oldFoundation.current.revision + 1}`,
      );
      const next = await (
        await page.request.get(`/api/projects/${imported.projectId}/foundation`)
      ).json();
      expect(
        next.history.find(
          (r: any) => r.revision === oldFoundation.current.revision,
        ),
      ).toEqual(oldFoundation.current);
      const nextFrozen = next.current.snapshot.references.find(
        (r: any) => r.id === id,
      );
      expect(nextFrozen.image).toBe(frozen.image);
      expect(
        await (
          await page.request.post("/api/migration/browser", { data: payload })
        ).json(),
      ).toEqual(imported);
      expect(
        (
          await (
            await page.request.get(
              `/api/projects/${imported.projectId}/foundation`,
            )
          ).json()
        ).current,
      ).toEqual(next.current);
      const artifact = {
        format,
        width,
        declaredType: image.headers()["content-type"],
        actualDecodedFormat: decoded.format,
        originalBytesUnchanged: true,
        frozenURIPrefix: frozen.image.slice(0, frozen.image.indexOf(",") + 1),
        browserRendered: true,
        bodySha256: createHash("sha256").update(body).digest("hex"),
        codexCalls: (await (await page.request.get("/api/health")).json())
          .codexCalls,
      };
      writeFileSync(
        `../evidence/legacy-image-mime-ui/${format}-${width}.json`,
        JSON.stringify(artifact, null, 2),
      );
    });
