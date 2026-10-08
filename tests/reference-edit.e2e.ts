import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { initialState } from "../src/client/state";
import type { SavedReference } from "../src/domain/reference";
import sharp from "sharp";
const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const r = (await (await request.get(base)).json()).references.find(
      (r: SavedReference) => r.id === id,
    );
    if (r)
      expect(
        (
          await request.delete(`${base}/${id}`, {
            data: { version: r.version },
          })
        ).ok(),
      ).toBe(true);
  }
});
const importedId = (id: string) =>
  createHash("sha256")
    .update(id)
    .digest("hex")
    .slice(0, 32)
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
const refs = async (page: Page, base: string) =>
  (await (await page.request.get(base)).json()).references as SavedReference[];
for (const width of [1440, 390])
  test(`legacy invalid name and URL remain original until explicit correction saves the same Reference at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const old = [
      {
        id: crypto.randomUUID(),
        name: "",
        url: `https://empty-name.example/${crypto.randomUUID()}`,
        aspects: ["Typography"],
      },
      {
        id: crypto.randomUUID(),
        name: `Long legacy ${"x".repeat(210)}`,
        url: `https://long-name.example/${crypto.randomUUID()}`,
        aspects: ["Typography"],
      },
      {
        id: crypto.randomUUID(),
        name: `Legacy relative URL ${width}`,
        url: `relative/${crypto.randomUUID()}`,
        aspects: ["Typography"],
      },
    ];
    const payload = { ...initialState, references: old };
    const response = await page.request.post("/api/migration/browser", {
      data: payload,
    });
    expect(response.ok()).toBe(true);
    const imported = await response.json(),
      base = `/api/projects/${imported.projectId}/references`,
      path = `/projects/${imported.projectId}/inspiration`;
    const ids = old.map((r) => importedId(r.id));
    for (const id of ids) created.push({ base, id });
    const before = (await refs(page, base)).filter((r) => ids.includes(r.id));
    expect(before).toHaveLength(3);
    const foundationBefore = await (
      await page.request.get(`/api/projects/${imported.projectId}/foundation`)
    ).json();
    await page.goto(path);
    for (const [index, source] of old.entries()) {
      const id = ids[index],
        newName = `Corrected legacy ${index} ${width}`,
        newURL =
          index === 2
            ? `https://corrected.example/${crypto.randomUUID()}`
            : source.url;
      const card = page.locator(".reference-card").filter({
        has: page
          .getByText(source.url, { exact: true })
          .or(page.getByText(newURL, { exact: true })),
      });
      const name = card.getByRole("textbox", {
          name: "参考の名前",
          exact: true,
        }),
        url = card.getByRole("textbox", { name: "参考URL", exact: true }),
        notes = card.getByRole("textbox", { name: "好きな点", exact: true }),
        save = card.getByRole("button", {
          name: "観点・メモを保存",
          exact: true,
        });
      await expect(name).toHaveValue(source.name);
      await expect(url).toHaveValue(source.url);
      expect((await refs(page, base)).find((r) => r.id === id)).toEqual(
        before.find((r) => r.id === id),
      );
      await notes.fill(`Keep my corrected source notes ${index}`);
      const rejected = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `${base}/${id}` &&
          r.request().method() === "PATCH",
      );
      await save.click();
      expect((await rejected).status()).toBe(400);
      await expect(notes).toBeEditable();
      expect((await refs(page, base)).find((r) => r.id === id)).toEqual(
        before.find((r) => r.id === id),
      );
      await name.fill(`  ${newName}  `);
      await url.fill(newURL);
      await expect(card).toContainText(
        "保存すると、この参考の分析・採用状態を解除します",
      );
      await expect(card).toContainText(
        "URLを変更すると画像・取得情報も外します",
      );
      expect((await refs(page, base)).find((r) => r.id === id)).toEqual(
        before.find((r) => r.id === id),
      );
      await page.reload();
      await expect(name).toHaveValue(`  ${newName}  `);
      await expect(url).toHaveValue(newURL);
      await expect(notes).toHaveValue(
        `Keep my corrected source notes ${index}`,
      );
      mkdirSync("../evidence/reference-edit-ui", { recursive: true });
      await name.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `../evidence/reference-edit-ui/editing-${index}-${width}.png`,
        fullPage: true,
      });
      await save.click();
      await expect(save).toBeDisabled();
      await expect(name).toBeEditable();
      await expect(name).toHaveValue(newName);
      await expect(url).toHaveValue(newURL);
      const accepted = (await refs(page, base)).find((r) => r.id === id)!;
      expect(accepted).toMatchObject({
        id,
        version: 2,
        name: newName,
        url: newURL,
        likes: `Keep my corrected source notes ${index}`,
        accepted: [],
      });
      expect(accepted.selections).toEqual(
        before.find((r) => r.id === id)!.selections,
      );
      await page.reload();
      await expect(name).toHaveValue(newName);
      await expect(notes).toHaveValue(
        `Keep my corrected source notes ${index}`,
      );
      await page.screenshot({
        path: `../evidence/reference-edit-ui/saved-${index}-${width}.png`,
        fullPage: true,
      });
    }
    const foundationAfter = await (
      await page.request.get(`/api/projects/${imported.projectId}/foundation`)
    ).json();
    expect(foundationAfter).toEqual(foundationBefore);
    expect(
      await (
        await page.request.post("/api/migration/browser", { data: payload })
      ).json(),
    ).toEqual(imported);
    const after = (await refs(page, base)).filter((r) => ids.includes(r.id));
    expect(after).toHaveLength(3);
    expect(after.every((r) => r.version === 2)).toBe(true);
    writeFileSync(
      `../evidence/reference-edit-ui/legacy-${width}.json`,
      JSON.stringify(
        {
          width,
          before,
          after,
          originalUntilExplicitSave: true,
          draftsRetainedThroughReload: true,
          oldFoundationSnapshotUnchanged: true,
          repeatedMigrationDidNotOverwriteCorrections: true,
          realCodexCalls: (await (await page.request.get("/api/health")).json())
            .codexCalls,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  });

for (const profile of [true, false])
  for (const width of [1440, 390])
    test(`${profile ? "Profile" : "Project"} explicit metadata edits preserve images for name changes and clear images for URL changes at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      let base = "/api/profile/references",
        path = "/profile",
        projectId = "";
      if (!profile) {
        const p = await (
          await page.request.post("/api/projects", {
            data: {
              brief: { name: `Metadata edits ${width}` },
              useTaste: false,
            },
          })
        ).json();
        projectId = p.id;
        base = `/api/projects/${p.id}/references`;
        path = `/projects/${p.id}/inspiration`;
      }
      const originalURL = `https://metadata-edit.example/${crypto.randomUUID()}`;
      const changedURL = `https://corrected.example/${crypto.randomUUID()}`;
      const originalName = `Metadata source ${profile} ${width}`;
      const changedName = `Explicitly corrected ${profile} ${width}`;
      const createdResponse = await page.request.post(base, {
        data: {
          name: originalName,
          url: originalURL,
          selections: [{ aspect: "Typography", intent: "reference" }],
          likes: "Original notes",
          dislikes: "",
        },
      });
      expect(createdResponse.ok()).toBe(true);
      const reference: SavedReference = await createdResponse.json();
      created.push({ base, id: reference.id });
      const foundationBefore = projectId
        ? await (
            await page.request.get(`/api/projects/${projectId}/foundation`)
          ).json()
        : null;
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      const showReferences = async () => {
        if (profile)
          await page
            .getByRole("button", { name: "参考を集める", exact: true })
            .click();
      };
      await showReferences();
      const card = page.locator(".reference-card").filter({
        has: page
          .getByText(originalURL, { exact: true })
          .or(page.getByText(changedURL, { exact: true })),
      });
      const name = card.getByRole("textbox", {
        name: "参考の名前",
        exact: true,
      });
      const url = card.getByRole("textbox", { name: "参考URL", exact: true });
      const save = card.getByRole("button", {
        name: "観点・メモを保存",
        exact: true,
      });
      const current = async () =>
        (await refs(page, base)).find((r) => r.id === reference.id)!;
      await card
        .getByLabel(`${originalName}の画像をアップロード`, { exact: true })
        .setInputFiles({
          name: "metadata.png",
          mimeType: "image/png",
          buffer: await sharp({
            create: {
              width: 100,
              height: 100,
              channels: 3,
              background: "white",
            },
          })
            .png()
            .toBuffer(),
        });
      await expect(card.getByRole("img")).toBeVisible();
      const analyzeAndAccept = async (existingProjectPolicy = false) => {
        await card.getByLabel("送信対象を確認しました").check();
        await card
          .getByRole("button", { name: "Codexで分析する", exact: true })
          .click();
        await expect(
          card.getByText("画像上部の見出し", { exact: true }),
        ).toBeVisible();
        if (existingProjectPolicy) {
          await expect(
            card.getByRole("button", { name: "方針保存済み", exact: true }),
          ).toBeDisabled();
          expect((await current()).accepted).toEqual([]);
          return;
        }
        await card
          .getByRole("button", {
            name: /^(設計方針として採用|プロジェクト方針として保存)$/,
            exact: true,
          })
          .click();
        await expect.poll(async () => (await current()).accepted).toEqual([0]);
        if (profile)
          await expect(
            page.getByRole("button", { name: "DNA・原則", exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
        else {
          await expect(
            card.getByRole("button", {
              name: /^(採用済み|方針保存済み)$/,
              exact: true,
            }),
          ).toBeVisible();
          await expect(name).toBeEditable();
        }
      };
      await analyzeAndAccept();
      const foundationAfterAdoption = projectId
        ? await (
            await page.request.get(`/api/projects/${projectId}/foundation`)
          ).json()
        : null;
      if (projectId) {
        expect(foundationAfterAdoption.current.revision).toBe(2);
        expect(foundationAfterAdoption.current.design).toEqual(
          foundationBefore.current.design,
        );
      }
      if (profile) {
        await page
          .getByRole("button", { name: "共通の好みを保存", exact: true })
          .click();
        await expect(
          page.getByText("共通の好みを保存しました", { exact: true }),
        ).toBeVisible();
        await showReferences();
      }
      const confirmedProfile = profile
        ? (await (await page.request.get("/api/profile")).json()).current
        : null;
      const analyzed = await current();
      expect(analyzed.analysis?.findings).toHaveLength(1);
      expect(analyzed.assetId).toBeTruthy();
      await name.fill(changedName);
      await expect(
        card.getByRole("button", { name: "Codexで分析する", exact: true }),
      ).toBeDisabled();
      expect(await current()).toEqual(analyzed);
      let release!: () => void, started!: () => void;
      const held = new Promise<void>((r) => {
        release = r;
      });
      const observed = new Promise<void>((r) => {
        started = r;
      });
      const exactPath = `${base}/${reference.id}`;
      await page.route(`**${exactPath}`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        const response = await route.fetch();
        started();
        await held;
        await route.fulfill({ response });
      });
      await save.click();
      await observed;
      try {
        await expect(name).toBeDisabled();
        await expect(url).toBeDisabled();
        await expect(save).toBeDisabled();
        await expect(name).toHaveValue(changedName);
      } finally {
        release();
      }
      await expect(name).toBeEditable();
      await page.unroute(`**${exactPath}`);
      const renamed = await current();
      expect(renamed).toMatchObject({
        id: reference.id,
        version: analyzed.version + 1,
        name: changedName,
        url: originalURL,
        assetId: analyzed.assetId,
        accepted: [],
      });
      expect(renamed.analysis).toBeUndefined();
      expect(renamed.analysisJobId).toBeUndefined();
      await expect(card.getByRole("img")).toBeVisible();
      await expect(
        card.getByText("画像上部の見出し", { exact: true }),
      ).toHaveCount(0);
      if (profile)
        expect(
          (await (await page.request.get("/api/profile")).json()).current,
        ).toEqual(confirmedProfile);
      await analyzeAndAccept(!profile);
      await showReferences();
      const reanalyzed = await current();
      await url.fill("relative/invalid-edit");
      const rejected = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === exactPath &&
          r.request().method() === "PATCH",
      );
      await save.click();
      expect((await rejected).status()).toBe(400);
      await expect(url).toBeEditable();
      expect(await current()).toEqual(reanalyzed);
      await page.reload();
      await showReferences();
      await expect(name).toHaveValue(changedName);
      await expect(url).toHaveValue("relative/invalid-edit");
      await url.fill(changedURL);
      await expect(card).toContainText(
        "URLを変更すると画像・取得情報も外します",
      );
      await expect(
        card.getByRole("button", { name: "Codexで分析する", exact: true }),
      ).toBeDisabled();
      const prefix = `../evidence/reference-edit-ui/${profile ? "Profile" : "Project"}-${width}`;
      await url.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${prefix}-before-url-save.png`,
        fullPage: true,
      });
      await save.click();
      await expect(save).toBeDisabled();
      await expect(url).toBeEditable();
      const changed = await current();
      expect(changed).toMatchObject({
        id: reference.id,
        version: reanalyzed.version + 1,
        name: changedName,
        url: changedURL,
        accepted: [],
      });
      expect(changed.assetId).toBeUndefined();
      expect(changed.capture).toBeUndefined();
      expect(changed.analysis).toBeUndefined();
      expect(changed.analysisJobId).toBeUndefined();
      await expect(card.getByRole("img")).toHaveCount(0);
      await expect(
        card.getByText("画像上部の見出し", { exact: true }),
      ).toHaveCount(0);
      await page.reload();
      await showReferences();
      await expect(name).toHaveValue(changedName);
      await expect(url).toHaveValue(changedURL);
      expect(await current()).toEqual(changed);
      if (profile)
        expect(
          (await (await page.request.get("/api/profile")).json()).current,
        ).toEqual(confirmedProfile);
      else
        expect(
          await (
            await page.request.get(`/api/projects/${projectId}/foundation`)
          ).json(),
        ).toEqual(foundationAfterAdoption);
      await page.screenshot({
        path: `${prefix}-after-url-save.png`,
        fullPage: true,
      });
      const codexCalls = (await (await page.request.get("/api/health")).json())
        .codexCalls;
      expect(codexCalls).toBe(0);
      writeFileSync(
        `${prefix}.json`,
        JSON.stringify(
          {
            analyzed,
            renamed,
            reanalyzed,
            changed,
            confirmedProfile,
            foundationBefore,
            foundationAfterAdoption,
            pendingInputsDisabled: true,
            failedURLDraftRetained: true,
            codexCalls,
          },
          null,
          2,
        ),
      );
      expect(errors).toEqual([]);
    });
