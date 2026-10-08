import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import type { SavedReference } from "../src/domain/reference";
const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const data = await (await request.get(base)).json();
    const ref = data.references.find((r: SavedReference) => r.id === id);
    if (ref)
      expect(
        (
          await request.delete(`${base}/${id}`, {
            data: { version: ref.version },
          })
        ).ok(),
      ).toBe(true);
  }
});
const input = (name: string) => ({
  name,
  url: "",
  selections: [{ aspect: "Typography", intent: "reference" }],
  likes: "",
  dislikes: "",
});
async function setup(
  page: Page,
  profile: boolean,
  width: number,
  kind: string,
) {
  await page.setViewportSize({ width, height: 1000 });
  let base = "/api/profile/references",
    path = "/profile",
    scope = "profile";
  if (!profile) {
    const p = await (
      await page.request.post("/api/projects", {
        data: {
          brief: { name: `Deleted Reference ${kind} ${width}` },
          useTaste: false,
        },
      })
    ).json();
    scope = p.id;
    base = `/api/projects/${p.id}/references`;
    path = `/projects/${p.id}/inspiration`;
  }
  const ref: SavedReference = await (
    await page.request.post(base, { data: input(`Deleted ${kind} ${width}`) })
  ).json();
  created.push({ base, id: ref.id });
  await page.goto(path);
  if (profile)
    await page
      .getByRole("button", { name: "参考を集める", exact: true })
      .click();
  const card = page.locator(".reference-card").filter({
    has: page.getByRole("heading", { name: ref.name, exact: true, level: 3 }),
  });
  await expect(card).toBeVisible();
  return {
    base,
    path,
    scope,
    ref,
    card,
    key: `tasteprint.${scope}.reference.${ref.id}`,
  };
}
async function holdReply(page: Page, endpoint: string) {
  let release!: () => void,
    entered!: () => void,
    accepted!: SavedReference,
    failRead = false,
    writes = 0;
  let releaseReads!: () => void;
  const readsReady = new Promise<void>((resolve) => (releaseReads = resolve));
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const base = endpoint.replace(
    /\/[a-f0-9-]+(?:\/(?:image|accept(?:-policy)?))?$/,
    "",
  );
  await page.route(`**${base}`, async (route) => {
    // Keep collection reads before fetch until this case chooses its boundary.
    if (route.request().method() === "GET") await readsReady;
    if (failRead && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { message: "Read failed after delayed reply" },
      });
    else await route.continue();
  });
  await page.route(`**${endpoint}`, async (route: Route) => {
    if (route.request().method() === "GET" || ++writes !== 1)
      return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const reply = await response.json();
    accepted = reply.reference ?? reply;
    entered();
    await gate;
    await route.fulfill({ response });
  });
  return {
    started,
    releaseReads,
    release,
    fail: () => (failRead = true),
    recover: () => (failRead = false),
    accepted: () => accepted,
    writes: () => writes,
  };
}
async function image(color: string) {
  return {
    name: "reference.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 1440, height: 1000, channels: 3, background: color },
    })
      .png()
      .toBuffer(),
  };
}
async function survivor(page: Page, base: string, name: string) {
  const ref: SavedReference = await (
    await page.request.post(base, {
      data: {
        ...input(name),
        url: "https://example.com/e2e-pending",
      },
    })
  ).json();
  created.push({ base, id: ref.id });
  const response = await page.request.post(`${base}/${ref.id}/jobs`, {
    data: {
      version: ref.version,
      type: "capture",
      key: crypto.randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  const job = await response.json();
  return { ref, job };
}
for (const profile of [true, false])
  for (const [kind, observeCommitted] of [
    ["notes", false],
    ["notes", true],
    ["image", true],
    ["accept", true],
  ] as const)
    test(`${profile ? "Profile" : "Project"} delayed ${kind} reply preserves a known Reference deletion with committed version ${observeCommitted ? "observed" : "unobserved"}`, async ({
      page,
    }) => {
      let profilePosts = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/profile"
        )
          profilePosts++;
      });
      const width = profile ? 390 : 1440;
      const f = await setup(page, profile, width, kind);
      const other = await survivor(page, f.base, `Survivor ${profile} ${kind}`);
      const otherCard = page.locator(".reference-card").filter({
        has: page.getByRole("heading", {
          name: other.ref.name,
          level: 3,
          exact: true,
        }),
      });
      await expect(otherCard.getByRole("status")).toContainText(
        /URL取得: (処理中|待機中)/,
        { timeout: 10000 },
      );
      let finding:
        | {
            aspect: string;
            recommendation: string;
            interpretation: string;
            evidence: string;
          }
        | undefined;
      if (kind === "accept") {
        await f.card
          .getByLabel(`${f.ref.name}の画像をアップロード`, { exact: true })
          .setInputFiles(await image("white"));
        await expect(f.card.getByRole("img")).toBeVisible();
        await f.card.getByLabel("送信対象を確認しました").check();
        await f.card
          .getByRole("button", { name: "Codexで分析する", exact: true })
          .click();
        await expect(
          f.card.getByText("画像上部の見出し", { exact: true }),
        ).toBeVisible();
        finding = (
          await (await page.request.get(f.base)).json()
        ).references.find((r: SavedReference) => r.id === f.ref.id).analysis
          .findings[0];
      }
      const endpoint = `${f.base}/${f.ref.id}${kind === "notes" ? "" : kind === "image" ? "/image" : profile ? "/accept" : "/accept-policy"}`;
      const held = await holdReply(page, endpoint);
      if (kind === "notes") {
        await f.card
          .getByRole("textbox", { name: "好きな点", exact: true })
          .fill("Keep my accepted notes draft after deletion");
        await expect
          .poll(() =>
            page.evaluate(
              (key) => JSON.parse(localStorage.getItem(key)!).likes,
              f.key,
            ),
          )
          .toBe("Keep my accepted notes draft after deletion");
        await f.card
          .getByRole("button", { name: "観点・メモを保存", exact: true })
          .click();
      } else if (kind === "image") {
        await f.card
          .getByLabel(`${f.ref.name}の画像をアップロード`, { exact: true })
          .setInputFiles(await image("white"));
      } else {
        await f.card
          .getByRole("button", {
            name: /^(設計方針として採用|プロジェクト方針として保存)$/,
            exact: true,
          })
          .click();
      }
      await held.started;
      let draftAtKnownDeletion: string | null = null;
      try {
        const submittedDraft = await page.evaluate(
          (key) => localStorage.getItem(key),
          f.key,
        );
        expect(submittedDraft).not.toBeNull();
        if (kind === "notes")
          expect(JSON.parse(submittedDraft!).baseVersion).toBe(f.ref.version);
        const expectedBase = observeCommitted
          ? held.accepted().version
          : f.ref.version;
        if (observeCommitted) {
          const committedRead = page.waitForResponse(async (response) => {
            if (
              new URL(response.url()).pathname !== f.base ||
              response.request().method() !== "GET" ||
              !response.ok()
            )
              return false;
            const data = await response.json();
            return data.references.some(
              (r: SavedReference) =>
                r.id === f.ref.id && r.version === expectedBase,
            );
          });
          held.releaseReads();
          await committedRead;
          await expect
            .poll(() =>
              page.evaluate(
                (key) => JSON.parse(localStorage.getItem(key)!).baseVersion,
                f.key,
              ),
            )
            .toBe(expectedBase);
        }
        const deleted = await page.request.delete(`${f.base}/${f.ref.id}`, {
          data: { version: held.accepted().version },
        });
        expect(deleted.ok()).toBe(true);
        held.releaseReads();
        await expect(f.card).toHaveCount(0, { timeout: 10000 });
        const actual = await (await page.request.get(f.base)).json();
        expect(
          actual.references.some((r: SavedReference) => r.id === f.ref.id),
        ).toBe(false);
        expect(
          actual.references.some((r: SavedReference) => r.id === other.ref.id),
        ).toBe(true);
        expect(
          actual.jobs.some((j: { id: string }) => j.id === other.job.id),
        ).toBe(true);
        // A matching committed read may legitimately advance the draft before
        // deletion. Preserve every byte from the known-deletion boundary onward.
        draftAtKnownDeletion = await page.evaluate(
          (key) => localStorage.getItem(key),
          f.key,
        );
        expect(JSON.parse(draftAtKnownDeletion!)).toEqual({
          ...JSON.parse(submittedDraft!),
          baseVersion: expectedBase,
        });
        held.fail();
      } finally {
        held.releaseReads();
        held.release();
      }
      if (profile && kind === "accept") {
        await expect(
          page.getByRole("button", { name: "DNA・原則", exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        const adopted = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("tasteprint.profile.draft")!)
              .principles,
        );
        expect(
          adopted.filter(
            (p: { id: string }) => p.id === `reference:${f.ref.id}:0`,
          ),
        ).toEqual([
          {
            id: `reference:${f.ref.id}:0`,
            target: finding!.aspect,
            text: finding!.recommendation,
            reason: finding!.interpretation,
            sources: [f.ref.name, finding!.evidence],
            locked: false,
          },
        ]);
        expect(profilePosts).toBe(0);
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      }
      await expect(
        page.getByRole("alert").filter({ hasText: "参考一覧の読み込みに失敗" }),
      ).toBeVisible();
      await expect(f.card).toHaveCount(0);
      await expect(otherCard).toBeVisible();
      await expect(otherCard.getByRole("status")).toContainText(
        /URL取得: (処理中|待機中)/,
      );
      expect(
        await page.evaluate((key) => localStorage.getItem(key), f.key),
      ).toBe(draftAtKnownDeletion);
      expect(held.writes()).toBe(1);
      mkdirSync("../evidence/reference-deleted-read-ui", { recursive: true });
      if (kind !== "notes" || !observeCommitted)
        await page.screenshot({
          path: `../evidence/reference-deleted-read-ui/${profile ? "Profile" : "Project"}-${kind}.png`,
          fullPage: true,
        });
      writeFileSync(
        `../evidence/reference-deleted-read-ui/${profile ? "Profile" : "Project"}-${kind}${kind === "notes" && observeCommitted ? "-observed" : ""}.json`,
        JSON.stringify(
          {
            scope: profile ? "Profile" : "Project",
            kind,
            width,
            deletedId: f.ref.id,
            acceptedVersion: held.accepted().version,
            observeCommittedBeforeDeletion: observeCommitted,
            retainedBaseVersion: JSON.parse(draftAtKnownDeletion!).baseVersion,
            draftRetained: true,
            cardAbsentAfterLateReplyAndGET503: true,
            survivorId: other.ref.id,
            survivorJobId: other.job.id,
            writes: held.writes(),
            actualPolling: true,
            profilePosts,
            realCodexCalls: 0,
          },
          null,
          2,
        ),
      );
      held.recover();
      await page
        .getByRole("button", { name: "一覧を再取得", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "一覧を再取得", exact: true }),
      ).toHaveCount(0);
      await expect(f.card).toHaveCount(0);
      expect(held.writes()).toBe(1);
      await page.reload();
      if (profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      await expect(otherCard).toBeVisible();
      await expect(f.card).toHaveCount(0);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), f.key),
      ).toBe(draftAtKnownDeletion);
      const final = await (await page.request.get(f.base)).json();
      expect(
        final.references.some((r: SavedReference) => r.id === f.ref.id),
      ).toBe(false);
      expect(
        final.jobs.some((j: { id: string }) => j.id === other.job.id),
      ).toBe(true);
    });
