import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { initialState } from "../src/client/state";
import type { SavedReference } from "../src/domain/reference";

for (const width of [1440, 390]) {
  test(`legacy unadopted URL preserves its Reference while UI ZIP export succeeds at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const old = {
      id: randomUUID(),
      name: `Unused legacy source ${width}`,
      url: `relative/${randomUUID()}`,
      aspects: ["Colors"],
    };
    let reference: SavedReference | undefined;
    let api = "";
    try {
      const imported = await page.request.post("/api/migration/browser", {
        data: { ...initialState, references: [old] },
      });
      expect(imported.ok()).toBe(true);
      const { projectId } = await imported.json();
      api = `/api/projects/${projectId}`;
      reference = (
        (await (await page.request.get(`${api}/references`)).json())
          .references as SavedReference[]
      ).find((ref) => ref.name === old.name)!;
      expect(reference.url).toBe(old.url);
      expect(reference.accepted).toEqual([]);
      const current = (
        await (await page.request.get(`${api}/foundation`)).json()
      ).current;
      expect(
        current.snapshot.references.some(
          (ref: { id: string }) => ref.id === reference!.id,
        ),
      ).toBe(true);
      await page.goto(`/projects/${projectId}/export`);
      await expect(
        page.getByText(
          `このプロジェクトの確定 r${current.revision} を出力します。未保存の編集は含みません。`,
        ),
      ).toBeVisible();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "画像なし ZIP を生成", exact: true })
        .click();
      const zip = await download;
      expect(zip.suggestedFilename()).toMatch(/\.zip$/);
      const bytes = await readFile((await zip.path())!);
      const entries = unzipSync(bytes);
      const jsonPath = Object.keys(entries).find((name) =>
        name.endsWith("/design-system.json"),
      )!;
      const exported = JSON.parse(Buffer.from(entries[jsonPath]).toString());
      expect(exported.projectId).toBe(projectId);
      expect(exported.revision).toBe(current.revision);
      expect(exported.design).toEqual(current.design);
      const text = Object.values(entries)
        .map((entry) => Buffer.from(entry).toString())
        .join("\n");
      expect(text).not.toContain(old.name);
      expect(text).not.toContain(old.url);
      await expect(page.getByText(/Draft · 画像なし/).last()).toBeVisible();
      const records = await (await page.request.get(`${api}/exports`)).json();
      const record = records.find(
        (r: { revision: number; imageMode: string }) =>
          r.revision === current.revision && r.imageMode === "omit",
      );
      expect(record).toBeTruthy();
      const again = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "画像なし ZIP を生成", exact: true })
        .click();
      expect(await readFile((await (await again).path())!)).toEqual(bytes);
      const repeated = await (await page.request.get(`${api}/exports`)).json();
      expect(
        repeated.filter(
          (r: { revision: number; imageMode: string }) =>
            r.revision === current.revision && r.imageMode === "omit",
        ),
      ).toHaveLength(1);
      expect(
        repeated.find((r: { id: string }) => r.id === record.id),
      ).toBeTruthy();
      expect(
        (await (await page.request.get(`${api}/foundation`)).json()).current,
      ).toEqual(current);
      const retained = (
        await (await page.request.get(`${api}/references`)).json()
      ).references.find((ref: SavedReference) => ref.id === reference!.id);
      expect(retained).toEqual(reference);
      const directory = "../evidence/unadopted-export-ui";
      mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: `${directory}/export-${width}.png`,
        fullPage: false,
      });
      writeFileSync(
        `${directory}/verified-${width}.json`,
        JSON.stringify(
          {
            projectId,
            revision: current.revision,
            referenceRetained: true,
            savedRevisionUnchanged: true,
            zipReused: true,
            outputOmitsUnusedSource: true,
            codexCalls: (await (await page.request.get("/api/health")).json())
              .codexCalls,
          },
          null,
          2,
        ),
      );
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      if (reference && api) {
        const refs = (
          await (await page.request.get(`${api}/references`)).json()
        ).references as SavedReference[];
        const current = refs.find((ref) => ref.id === reference!.id);
        if (current)
          expect(
            (
              await page.request.delete(`${api}/references/${current.id}`, {
                data: { version: current.version },
              })
            ).ok(),
          ).toBe(true);
      }
    }
  });
}
