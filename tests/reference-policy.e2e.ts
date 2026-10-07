import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { SavedReference } from "../src/domain/reference";
const evidence = "../evidence/reference-policy";
async function setup(page: Page, width: number, name: string) {
  await page.setViewportSize({ width, height: 1000 });
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: `${name} ${width}` }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${p.id}`,
    path = `/projects/${p.id}`;
  await page.goto(`${path}/inspiration`);
  async function reference(name: string) {
    const r = await (
      await page.request.post(`${base}/references`, {
        data: {
          name,
          url: "",
          selections: [{ aspect: "Typography", intent: "reference" }],
          likes: "",
          dislikes: "",
        },
      })
    ).json();
    await page.reload();
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card
      .getByLabel(`${name}の画像をアップロード`, { exact: true })
      .setInputFiles({
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 80, height: 80, channels: 3, background: "white" },
        })
          .png()
          .toBuffer(),
      });
    await expect(card.getByRole("img")).toBeVisible();
    await card.getByLabel("送信対象を確認しました", { exact: true }).check();
    await card
      .getByRole("button", { name: "Codexで分析する", exact: true })
      .click();
    await expect(
      card.getByText("画像上部の見出し", { exact: true }),
    ).toBeVisible();
    const ref: SavedReference = (
      await (await page.request.get(`${base}/references`)).json()
    ).references.find((x: SavedReference) => x.id === r.id);
    return {
      ref,
      card,
      button: card.getByRole("button", {
        name: "プロジェクト方針として保存",
        exact: true,
      }),
    };
  }
  const f = await reference(`Policy source ${width}`);
  return { base, path, p, ...f, reference };
}
async function navigate(page: Page, path: string) {
  const link = page.locator(`#app-navigation a[href="${path}"]`);
  if (!(await link.isVisible()))
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await link.click();
}
async function zip(page: Page, base: string, revision: number) {
  const response = await page.request.post(`${base}/exports`, {
    data: { baseRevision: revision, bundle: true, imageMode: "omit" },
  });
  expect(response.ok()).toBe(true);
  const record = await response.json();
  const name = Object.keys(record.files).find((n) => n.endsWith(".zip"))!;
  const bytes = await (
    await page.request.get(
      `${base}/exports/${record.id}/${encodeURIComponent(name)}`,
    )
  ).body();
  const files = Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([p, b]) => [
      p.split("/").slice(1).join("/"),
      b,
    ]),
  );
  return {
    record,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    json: JSON.parse(strFromU8(files["design-system.json"])),
    markdown: strFromU8(files["DESIGN.md"]),
  };
}
for (const width of [1440, 390]) {
  test(`Project reference policy ${width} is frozen immediately for proposal, Review and ZIP, with legacy acceptance explicit`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    mkdirSync(evidence, { recursive: true });
    const f = await setup(page, width, "Policy adoption"),
      negative = await f.reference(`POLICY_NEGATIVE_${width}`);
    const shared = await (await page.request.get("/api/profile")).json(),
      before = await (await page.request.get(f.base)).json();
    const other = await (
        await page.request.post("/api/projects", {
          data: { brief: { name: "Policy other" }, useTaste: false },
        })
      ).json(),
      otherBefore = await (
        await page.request.get(`/api/projects/${other.id}`)
      ).json();
    const old = await zip(page, f.base, 1);
    // Preserve an existing clean Overview draft; adoption must not rewrite it.
    await navigate(page, `${f.path}/overview`);
    await expect(page.getByText("概要・設計方針 · 確定 r1")).toBeVisible();
    await navigate(page, `${f.path}/inspiration`);
    // Existing accepted Reference rows are not silently promoted or migrated.
    const legacy = await page.request.post(
      `${f.base}/references/${f.ref.id}/accept`,
      { data: { version: f.ref.version, index: 0 } },
    );
    expect(legacy.ok()).toBe(true);
    await page.reload();
    await expect(f.button).toBeEnabled();
    await page.screenshot({
      path: `${evidence}/before-${width}.png`,
      fullPage: true,
    });
    await f.button.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/before-action-${width}.png` });
    await f.button.click();
    await expect(
      f.card.getByRole("button", { name: "方針保存済み", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".save-status")).toContainText("設計 r2");
    const current = await (await page.request.get(f.base)).json(),
      policy = current.current.snapshot.policies[0];
    expect(current.current.design).toEqual(before.current.design);
    expect(policy.text).toBe(f.ref.analysis!.findings[0].recommendation);
    expect(current.current.snapshot.policies).toHaveLength(1);
    expect(current.current.snapshot.taste.principles).toEqual([]);
    await page.screenshot({
      path: `${evidence}/after-${width}.png`,
      fullPage: true,
    });
    await f.card
      .getByRole("button", { name: "方針保存済み", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/after-action-${width}.png` });
    const proposal = await page.request.post(`${f.base}/foundation/proposals`, {
      data: { baseRevision: 2, prompt: `POLICY_TRACE_${f.p.id}` },
    });
    expect(proposal.ok()).toBe(true);
    const review = await page.request.post(`${f.base}/reviews`, {
      data: { baseRevision: 2 },
    });
    expect(review.ok()).toBe(true);
    expect((await review.json()).status).toBe("complete");
    const provider = await (
      await page.request.get("/api/e2e-provider-inputs")
    ).json();
    const proposalInput = provider.proposals.find((x: { prompt: string }) =>
        x.prompt.startsWith(`POLICY_TRACE_${f.p.id}`),
      ),
      reviewInput = provider.reviews.at(-1);
    expect(proposalInput.prompt).toContain(policy.text);
    expect(
      reviewInput.rules.some(
        (r: { id: string }) => r.id === `project.${policy.id}`,
      ),
    ).toBe(true);
    expect(JSON.stringify(proposalInput)).not.toContain(
      "UNADOPTED_POLICY_MARKER",
    );
    expect(JSON.stringify(reviewInput)).not.toContain(
      "UNADOPTED_POLICY_MARKER",
    );
    const bundle = await zip(page, f.base, 2);
    expect(bundle.json.policies).toEqual([policy]);
    expect(JSON.stringify(bundle.json)).not.toContain(
      "UNADOPTED_POLICY_MARKER",
    );
    expect(bundle.markdown).toContain(policy.text);
    const oldAgain = await zip(page, f.base, 1);
    expect(oldAgain.record.id).toBe(old.record.id);
    expect(oldAgain.bytes.equals(old.bytes)).toBe(true);
    expect(await (await page.request.get("/api/profile")).json()).toEqual(
      shared,
    );
    expect(
      await (await page.request.get(`/api/projects/${other.id}`)).json(),
    ).toEqual(otherBefore);
    await navigate(page, `${f.path}/overview`);
    await expect(
      page.getByRole("button", { name: "最新の確定版を読み込む", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "最新の確定版を読み込む", exact: true })
      .click();
    await expect(
      page.locator(".principle-fields").getByLabel("原則", { exact: true }),
    ).toHaveValue(policy.text);
    writeFileSync(`${evidence}/r2-${width}.zip`, bundle.bytes);
    writeFileSync(`${evidence}/r1-${width}.zip`, old.bytes);
    writeFileSync(
      `${evidence}/verification-${width}.json`,
      JSON.stringify(
        {
          base: "fd11a07",
          width,
          projectId: f.p.id,
          policy,
          proposalInput,
          reviewInput,
          exportJSON: bundle.json,
          oldZipSha256: old.sha256,
          newZipSha256: bundle.sha256,
          oldZipPreserved: true,
          designUnchanged: true,
          sharedUnchanged: true,
          projectIsolation: true,
          negativeReferenceId: negative.ref.id,
          realAiCalls: (await (await page.request.get("/api/health")).json())
            .codexCalls,
        },
        null,
        2,
      ),
    );
  });
  test(`Project policy ${width} blocks unsaved design and Overview without wiping either draft`, async ({
    page,
  }) => {
    const f = await setup(page, width, "Dirty adoption");
    let posts = 0;
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/accept-policy")
      )
        posts++;
    });
    await navigate(page, `${f.path}/foundation`);
    await page
      .getByRole("textbox", { name: "accent", exact: true })
      .fill("#ab1234");
    await navigate(page, `${f.path}/inspiration`);
    await expect(f.button).toBeDisabled();
    expect(posts).toBe(0);
    await navigate(page, `${f.path}/foundation`);
    await expect(
      page.getByRole("textbox", { name: "accent", exact: true }),
    ).toHaveValue("#ab1234");
    await page
      .getByRole("button", { name: "未保存の変更を取り消す", exact: true })
      .click();
    await navigate(page, `${f.path}/overview`);
    await page.getByLabel("用途", { exact: true }).fill("USER_UNSAVED_PURPOSE");
    await navigate(page, `${f.path}/inspiration`);
    await f.button.click();
    await expect(page.getByRole("alert")).toContainText("未保存・古い概要");
    expect(posts).toBe(0);
    await navigate(page, `${f.path}/overview`);
    await expect(page.getByLabel("用途", { exact: true })).toHaveValue(
      "USER_UNSAVED_PURPOSE",
    );
    expect(
      (await (await page.request.get(f.base)).json()).current.revision,
    ).toBe(1);
  });
  test(`Project policy ${width} lost receipt can be confirmed by exact GET after null, while pending navigation stays protected`, async ({
    page,
  }) => {
    const f = await setup(page, width, "Lost adoption");
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      seen = new Promise<void>((r) => (started = r));
    const bodies: unknown[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/accept-policy")
      )
        bodies.push(r.postDataJSON());
    });
    await page.route(
      `**${f.base}/references/${f.ref.id}/accept-policy`,
      async (route) => {
        await route.fetch();
        started();
        await gate;
        await route.abort();
      },
    );
    await f.button.click();
    await seen;
    try {
      await navigate(page, `${f.path}/foundation`);
      await expect(page).toHaveURL(new RegExp(`${f.path}/inspiration$`));
      await expect(
        page.getByRole("status").filter({ hasText: "方針の保存が完了" }),
      ).toBeVisible();
    } finally {
      release();
    }
    await expect(
      page.getByRole("button", { name: "採用結果を再取得", exact: true }),
    ).toBeEnabled();
    const getPattern = `**${f.base}/references/${f.ref.id}/accept-policy/result?*`;
    await page.route(getPattern, (route) => route.fulfill({ json: null }));
    await page
      .getByRole("button", { name: "採用結果を再取得", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "まだ確認できません" }),
    ).toBeVisible();
    await expect(page.locator(".save-status")).toContainText("設計 r1");
    expect(bodies).toHaveLength(1);
    await page.unroute(getPattern);
    await page
      .getByRole("button", { name: "採用結果を再取得", exact: true })
      .click();
    await expect(page.locator(".save-status")).toContainText("設計 r2");
    expect(bodies).toHaveLength(1);
    expect(
      (await (await page.request.get(f.base)).json()).current.snapshot.policies,
    ).toHaveLength(1);
  });
}
test("Project policy lost receipt retries the identical payload once without a second revision", async ({
  page,
}) => {
  const f = await setup(page, 390, "Retry adoption");
  const bodies: unknown[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/accept-policy")
    )
      bodies.push(r.postDataJSON());
  });
  const pattern = `**${f.base}/references/${f.ref.id}/accept-policy`;
  await page.route(pattern, async (route) => {
    await route.fetch();
    await route.abort();
  });
  await f.button.click();
  await expect(
    page.getByRole("button", { name: "同じ採用を再試行", exact: true }),
  ).toBeEnabled();
  await page.unroute(pattern);
  await page
    .getByRole("button", { name: "同じ採用を再試行", exact: true })
    .click();
  await expect(page.locator(".save-status")).toContainText("設計 r2");
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(
    (await (await page.request.get(`${f.base}/foundation`)).json()).history,
  ).toHaveLength(2);
});
test("Late exact result reads leave a newer Overview draft untouched", async ({
  page,
}) => {
  const f = await setup(page, 390, "Read recovery draft");
  const post = `**${f.base}/references/${f.ref.id}/accept-policy`;
  await page.route(post, async (route) => {
    await route.fetch();
    await route.abort();
  });
  await f.button.click();
  await expect(
    page.getByRole("button", { name: "採用結果を再取得", exact: true }),
  ).toBeEnabled();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    seen = new Promise<void>((r) => (started = r));
  await page.route(
    `**${f.base}/references/${f.ref.id}/accept-policy/result?*`,
    async (route) => {
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response });
    },
  );
  await page
    .getByRole("button", { name: "採用結果を再取得", exact: true })
    .click();
  await seen;
  try {
    await navigate(page, `${f.path}/overview`);
    await page
      .getByLabel("用途", { exact: true })
      .fill("NEW_DRAFT_DURING_RESULT_GET");
  } finally {
    release();
  }
  await expect(page.getByText("概要・設計方針 · 確定 r2")).toBeVisible();
  await expect(page.getByLabel("用途", { exact: true })).toHaveValue(
    "NEW_DRAFT_DURING_RESULT_GET",
  );
  expect(
    JSON.parse(
      (await page.evaluate(
        (id) => localStorage.getItem(`tasteprint.${id}.overview`),
        f.p.id,
      )) || "{}",
    ).brief.purpose,
  ).toBe("NEW_DRAFT_DURING_RESULT_GET");
});

for (const retry of [false, true]) {
  test(`Recovered policy ${retry ? "POST retry" : "exact GET"} commits the source version before a failed auxiliary list read`, async ({
    page,
  }) => {
    const f = await setup(page, 390, "Receipt source cache");
    let failRead = false;
    await page.route(`**${f.base}/references`, (route) =>
      failRead && route.request().method() === "GET"
        ? route.fulfill({ status: 503, json: { message: "list unavailable" } })
        : route.continue(),
    );
    const pattern = `**${f.base}/references/${f.ref.id}/accept-policy`;
    await page.route(pattern, async (route) => {
      await route.fetch();
      failRead = true;
      await route.abort();
    });
    await f.button.click();
    await expect(
      page.getByRole("button", { name: "採用結果を再取得", exact: true }),
    ).toBeEnabled();
    if (retry) await page.unroute(pattern);
    await page
      .getByRole("button", {
        name: retry ? "同じ採用を再試行" : "採用結果を再取得",
        exact: true,
      })
      .click();
    await expect(page.locator(".save-status")).toContainText("設計 r2");
    await expect(
      page.getByRole("alert").filter({ hasText: "参考一覧の読み込みに失敗" }),
    ).toBeVisible();
    await f.card
      .getByRole("textbox", { name: "好きな点", exact: true })
      .fill("AFTER_RECOVERED_POLICY");
    const patch = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `${f.base}/references/${f.ref.id}` &&
        r.request().method() === "PATCH",
    );
    await f.card
      .getByRole("button", { name: "観点・メモを保存", exact: true })
      .click();
    const response = await patch;
    expect(response.request().postDataJSON().version).toBe(f.ref.version + 1);
    expect(response.status()).toBe(200);
    expect((await response.json()).likes).toBe("AFTER_RECOVERED_POLICY");
  });
}
for (const invalid of [
  "missing revision",
  "other project",
  "wrong policy",
  "invalid reference",
]) {
  test(`Malformed policy receipt (${invalid}) retains the exact operation for read recovery`, async ({
    page,
  }) => {
    const f = await setup(page, 390, "Invalid receipt");
    await page.route(
      `**${f.base}/references/${f.ref.id}/accept-policy`,
      async (route) => {
        const response = await route.fetch(),
          body = await response.json();
        if (invalid === "missing revision") delete body.revision.revision;
        else if (invalid === "other project")
          body.revision.snapshot.projectId = "another-project";
        else if (invalid === "wrong policy")
          body.revision.snapshot.policies[0].text = "UNTRUSTED_POLICY";
        else body.reference.capture = {};
        await route.fulfill({ json: body });
      },
    );
    await f.button.click();
    await expect(
      page.getByRole("button", { name: "採用結果を再取得", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("status").filter({ hasText: "プロジェクト方針を設計" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "採用結果を再取得", exact: true })
      .click();
    await expect(
      f.card.getByRole("button", { name: "方針保存済み", exact: true }),
    ).toBeDisabled();
    expect(
      (await (await page.request.get(`${f.base}/foundation`)).json()).history,
    ).toHaveLength(2);
    expect(
      (await (await page.request.get(f.base)).json()).current.snapshot
        .policies[0].text,
    ).toBe(f.ref.analysis!.findings[0].recommendation);
  });
}
test("Pending proposal prevents Project policy adoption until the candidate is explicitly dismissed", async ({
  page,
}) => {
  const f = await setup(page, 1440, "Pending proposal");
  await navigate(page, `${f.path}/foundation`);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    seen = new Promise<void>((r) => (started = r));
  await page.route(`**${f.base}/foundation/proposals`, async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  await page
    .getByRole("textbox", { name: "デザインへのリクエスト", exact: true })
    .fill("POLICY_PENDING_PROPOSAL");
  await page.getByRole("button", { name: "提案を依頼", exact: true }).click();
  await seen;
  try {
    await navigate(page, `${f.path}/inspiration`);
    await expect(f.button).toBeDisabled();
  } finally {
    release();
  }
  await navigate(page, `${f.path}/foundation`);
  await expect(
    page.getByRole("button", { name: "見送る", exact: true }),
  ).toBeEnabled();
  await navigate(page, `${f.path}/inspiration`);
  await expect(f.button).toBeDisabled();
  await navigate(page, `${f.path}/foundation`);
  await page.getByRole("button", { name: "見送る", exact: true }).click();
  await navigate(page, `${f.path}/inspiration`);
  await expect(f.button).toBeEnabled();
  expect((await (await page.request.get(f.base)).json()).current.revision).toBe(
    1,
  );
});

test("Explicit adoption of an accepted legacy Reference preserves long raw metadata and unknown legacy Taste answers", async ({
  page,
}) => {
  const { initialState } = await import("../src/client/state");
  // An existing confirmed shared Taste is retained by legacy Project import.
  const taste = await (await page.request.get("/api/profile")).json();
  if (!taste.current.snapshot.confirmed) {
    const confirmed = await page.request.post("/api/profile", {
      data: {
        baseProfileRevision: taste.current.revision,
        answers: { ...taste.current.snapshot.answers, "density-0": "a" },
        reasons: taste.current.snapshot.reasons,
        principles: taste.current.snapshot.principles,
      },
    });
    expect(confirmed.ok()).toBe(true);
  }
  const sharedBefore = await (await page.request.get("/api/profile")).json();
  const raw = {
    ...structuredClone(initialState),
    answers: { "legacy-axis": "a" },
    references: [
      {
        id: crypto.randomUUID(),
        name: `Legacy-${"x".repeat(210)}`,
        url: "",
        aspects: [],
        principles: [
          {
            aspect: "Typography",
            observation: "heading",
            interpretation: "legacy reason",
            recommendation: "LEGACY_EXPLICIT_POLICY",
            certainty: "medium",
            evidence: "legacy evidence",
          },
        ],
      },
    ],
  };
  raw.references[0].principles = Array.from({ length: 25 }, (_, index) => ({
    ...raw.references[0].principles[0],
    evidence: `legacy evidence ${index}`,
  }));
  const imported = await page.request.post("/api/migration/browser", {
    data: raw,
  });
  expect(imported.ok()).toBe(true);
  const { projectId } = await imported.json(),
    base = `/api/projects/${projectId}`;
  const prior = await (await page.request.get(base)).json(),
    ref = (
      await (await page.request.get(`${base}/references`)).json()
    ).references.find((r: SavedReference) => r.name === raw.references[0].name);
  expect(ref.selections).toEqual([]);
  expect(ref.accepted).toEqual(Array.from({ length: 25 }, (_, i) => i));
  expect(prior.current.snapshot.taste.answers).toEqual(raw.answers);
  try {
    await page.goto(`/projects/${projectId}/inspiration`);
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: ref.name, exact: true }),
    });
    await card
      .getByRole("button", { name: "プロジェクト方針として保存", exact: true })
      .first()
      .click();
    await expect(
      card.getByRole("button", { name: "方針保存済み", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "採用結果を再取得", exact: true }),
    ).toHaveCount(0);
    const current = await (await page.request.get(base)).json();
    expect(current.current.revision).toBe(prior.current.revision + 1);
    expect(
      current.current.snapshot.policies.some(
        (p: { text: string }) => p.text === "LEGACY_EXPLICIT_POLICY",
      ),
    ).toBe(true);
    expect(current.current.snapshot.taste.answers).toEqual(raw.answers);
    expect(await (await page.request.get("/api/profile")).json()).toEqual(
      sharedBefore,
    );
    expect(
      (
        await (await page.request.get(`${base}/references`)).json()
      ).references.find((r: SavedReference) => r.id === ref.id),
    ).toEqual(ref);
  } finally {
    const removed = await page.request.delete(`${base}/references/${ref.id}`, {
      data: { version: ref.version },
    });
    expect(removed.ok()).toBe(true);
    // The legacy Project is shared by migration fixtures; remove only our policy.
    const latest = await (await page.request.get(base)).json();
    const policies = latest.current.snapshot.policies.filter(
      (p: { id: string }) => p.id !== `reference:${ref.id}:0`,
    );
    if (policies.length !== latest.current.snapshot.policies.length) {
      const restored = await page.request.post(base, {
        data: {
          baseRevision: latest.current.revision,
          brief: latest.current.snapshot.brief,
          policies,
        },
      });
      expect(restored.ok()).toBe(true);
    }
  }
});
