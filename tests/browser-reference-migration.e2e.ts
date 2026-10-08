import { test, expect } from "@playwright/test";
import { initialState } from "../src/client/state";
import { mkdirSync, writeFileSync } from "node:fs";

for (const width of [1440, 390]) {
  test(`browser migration retains independent same-URL evidence and completed replay at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const key = "tasteprint.workspace.v3";
    const suffix = crypto.randomUUID();
    const references = (["Density", "Colors"] as const).map((aspect) => ({
      id: crypto.randomUUID(),
      name: `Legacy ${aspect} ${suffix}`,
      url: `https://same-url-migration.example/${suffix}`,
      aspects: [aspect],
      principles: [
        {
          aspect,
          observation: `${aspect} observation`,
          interpretation: `${aspect} interpretation`,
          recommendation: `${aspect} recommendation`,
          certainty: "medium" as const,
          evidence: `${aspect} evidence`,
        },
      ],
    }));
    const raw = { ...structuredClone(initialState), references };
    const original = JSON.stringify(raw);
    const profile = await (await page.request.get("/api/profile")).json();
    await page.addInitScript(
      ({ key, original }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, original);
      },
      { key, original },
    );
    let uiMigrationPosts = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/migration/browser" &&
        request.method() === "POST"
      )
        uiMigrationPosts++;
    });
    const base = "/api/projects/legacy";
    let owned: { id: string; version: number }[] = [];
    try {
      await page.goto("/projects/legacy/inspiration");
      for (const source of references) {
        const card = page.getByRole("article").filter({
          has: page.getByRole("heading", {
            name: source.name,
            level: 3,
            exact: true,
          }),
        });
        await expect(card).toBeVisible();
        await expect(
          card.getByRole("combobox", {
            name: `${source.name} ${source.aspects[0]}`,
            exact: true,
          }),
        ).toHaveValue("reference");
        await expect(
          card.getByText(source.principles[0].recommendation, { exact: true }),
        ).toBeVisible();
        await expect(
          card.getByRole("button", {
            name: "プロジェクト方針として保存",
            exact: true,
          }),
        ).toBeEnabled();
      }
      const stored = await (
        await page.request.get(`${base}/references`)
      ).json();
      owned = stored.references.filter((row: { name: string }) =>
        references.some((source) => source.name === row.name),
      );
      expect(owned).toHaveLength(2);
      expect(new Set(owned.map((row) => row.id)).size).toBe(2);
      const foundation = await (
        await page.request.get(`${base}/foundation`)
      ).json();
      const frozen = foundation.current.snapshot.references.filter(
        (row: { id: string }) => owned.some((record) => record.id === row.id),
      );
      expect(frozen.map((row: { name: string }) => row.name)).toEqual(
        references.map((source) => source.name),
      );
      const replay = await page.request.post("/api/migration/browser", {
        data: raw,
      });
      expect(replay.ok()).toBe(true);
      expect((await replay.json()).projectId).toBe("legacy");
      await page.reload();
      for (const source of references)
        await expect(
          page.getByRole("heading", {
            name: source.name,
            level: 3,
            exact: true,
          }),
        ).toBeVisible();
      expect(
        await (await page.request.get(`${base}/references`)).json(),
      ).toEqual(stored);
      expect(
        await (await page.request.get(`${base}/foundation`)).json(),
      ).toEqual(foundation);
      expect(await (await page.request.get("/api/profile")).json()).toEqual(
        profile,
      );
      expect(uiMigrationPosts).toBe(1);
      expect(
        await page.evaluate(
          (key) => ({
            source: localStorage.getItem(key),
            backup: localStorage.getItem(`${key}.backup-before-projects`),
            marker: localStorage.getItem("tasteprint.projects.migrated.v1"),
          }),
          key,
        ),
      ).toEqual({ source: original, backup: original, marker: "complete" });
      const health = await (await page.request.get("/api/health")).json();
      expect(health.codexCalls).toBe(0);
      const directory = "../evidence/migration-same-url/ui";
      mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: `${directory}/${width}.png`,
        fullPage: true,
      });
      writeFileSync(
        `${directory}/${width}.json`,
        JSON.stringify(
          {
            width,
            importedIds: owned.map((row) => row.id),
            separateNames: references.map((source) => source.name),
            url: references[0].url,
            independentAcceptedEvidence: true,
            completedReplayUnchanged: true,
            sourceAndBackupPreserved: true,
            profileUnchanged: true,
            uiMigrationPosts,
            realCodexCalls: health.codexCalls,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      const current = await page.request.get(`${base}/references`);
      if (current.ok()) {
        for (const row of (await current.json()).references.filter(
          (row: { name: string }) =>
            references.some((source) => source.name === row.name),
        ))
          expect(
            (
              await page.request.delete(`${base}/references/${row.id}`, {
                data: { version: row.version },
              })
            ).ok(),
          ).toBe(true);
      }
    }
  });
}
