import { test, expect, type Page } from "@playwright/test";
import type { ExportRecord } from "../src/server/projects/service";
test("Overview taste adoption shows its committed reply despite follow-up GET failure", async ({
  page,
}) => {
  const initial = await (await page.request.get("/api/profile")).json();
  const profile = await (
    await page.request.post("/api/profile", {
      data: {
        baseProfileRevision: initial.current.revision,
        ...initial.current.snapshot,
        confirmed: true,
        answers: { "density-0": "a" },
      },
    })
  ).json();
  const project = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name: "Overview adopt response proof" },
        useTaste: true,
        sourceTasteProfileRevision: profile.revision,
      },
    })
  ).json();
  await page.request.post("/api/profile", {
    data: {
      baseProfileRevision: profile.revision,
      ...profile.snapshot,
      answers: { "density-0": "b" },
    },
  });
  const base = `/api/projects/${project.id}`;
  await page.goto(`/projects/${project.id}/overview`);
  await page.getByRole("button", { name: "差分を確認", exact: true }).click();
  await page
    .getByLabel("差分 answer:density-0", { exact: true })
    .selectOption("adopt");
  let fail = false;
  await page.route(`**${base}`, async (route) => {
    if (fail && route.request().method() === "GET")
      await route.fulfill({ status: 503, json: { message: "採用後GET失敗" } });
    else await route.continue();
  });
  await page.route(`**${base}/taste-diff`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    fail = true;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", {
      name: "選択を確定して新revisionを作成",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "差分を確認", exact: true }),
  ).toBeEnabled();
  expect((await (await page.request.get(base)).json()).current.revision).toBe(
    2,
  );
  await expect(page.locator(".editor-actions")).toContainText("設計 r2");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.screenshot({
      path: `test-results/query-cache-overview-${width}.png`,
    });
  }
  await page
    .getByLabel("プロジェクト名", { exact: true })
    .fill("採用後の次保存");
  await page
    .getByRole("button", { name: "概要・方針を保存", exact: true })
    .click();
  await expect(page.locator(".editor-actions")).toContainText("設計 r3");
  expect(
    (await (await page.request.get(base)).json()).current.snapshot.brief.name,
  ).toBe("採用後の次保存");
  fail = false;
  await page.reload();
  await expect(page.locator(".editor-actions")).toContainText("設計 r3");
});

test("Overview promotion retains its successful shared Profile revision after GET failure", async ({
  page,
}) => {
  const initial = await (await page.request.get("/api/profile")).json();
  const project = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name: "Promotion response proof" },
        useTaste: true,
        sourceTasteProfileRevision: initial.current.revision,
      },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  const saved = await (await page.request.get(base)).json();
  const principle = {
    id: "explicit-own",
    target: "density",
    text: "一覧は行で比較する",
    reason: "比較を助ける",
    sources: ["設計レビュー"],
    locked: false,
  };
  await page.request.post(base, {
    data: {
      baseRevision: 1,
      brief: saved.current.snapshot.brief,
      policies: [principle],
    },
  });
  await page.goto(`/projects/${project.id}/overview`);
  await page.locator(".promotion-choice input").check();
  await page
    .getByLabel("選択した原則・理由・出典を共通へ追加することを確認しました", {
      exact: true,
    })
    .check();
  let fail = false;
  await page.route("**/api/profile", async (route) => {
    if (fail && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { message: "共通追加後GET失敗" },
      });
    else await route.continue();
  });
  await page.route(`**${base}/promote`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    fail = true;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "選択した判断を共通に追加", exact: true })
    .click();
  await expect(page.locator(".promotion-choice input")).not.toBeChecked();
  const current = await (await page.request.get("/api/profile")).json();
  expect(current.current.revision).toBe(initial.current.revision + 1);
  expect(current.current.snapshot.principles).toContainEqual(principle);
  await expect(
    page.getByText("共通の好みに更新があります · 差分を確認", { exact: true }),
  ).toBeVisible();
  await page.locator(".promotion-choice input").check();
  await page
    .getByLabel("選択した原則・理由・出典を共通へ追加することを確認しました", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "選択した判断を共通に追加", exact: true })
    .click();
  await expect(page.locator(".promotion-choice input")).not.toBeChecked();
  expect(
    (await (await page.request.get("/api/profile")).json()).current.revision,
  ).toBe(initial.current.revision + 2);
  fail = false;
  await page
    .locator("nav")
    .getByRole("link", { name: "自分の好み", exact: true })
    .click();
  await expect(page.locator(".editor-actions")).toContainText(
    `共通 r${initial.current.revision + 2}`,
  );
  await page.reload();
  await expect(page.locator(".editor-actions")).toContainText(
    `共通 r${initial.current.revision + 2}`,
  );
});

test("archive successful reply changes the list even if GET fails", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Archive reply proof" }, useTaste: false },
    })
  ).json();
  await page.goto("/projects");
  const card = page.locator(".project-list article").filter({
    has: page.getByRole("heading", {
      name: "Archive reply proof",
      exact: true,
    }),
  });
  let fail = false;
  await page.route("**/api/projects", async (route) => {
    if (fail && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { message: "一覧補助GET失敗" },
      });
    else await route.continue();
  });
  await page.route(`**/api/projects/${project.id}/archive`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    fail = true;
    await route.fulfill({ response });
  });
  await card.getByRole("button", { name: "アーカイブ", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("一覧補助GET失敗");
  expect(
    (await (await page.request.get(`/api/projects/${project.id}`)).json())
      .project.archivedAt,
  ).not.toBeNull();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
  await expect(
    card.getByRole("button", { name: "アーカイブ解除", exact: true }),
  ).toBeEnabled();
  await card
    .getByRole("button", { name: "アーカイブ解除", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("一覧補助GET失敗");
  fail = false;
  await page
    .getByRole("button", { name: "一覧を再読み込み", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: /^進行中 \(/ }).click();
  await expect(card).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();
});
test("export successful record stays available when history GET fails", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Export reply proof" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  await page.goto(`/projects/${project.id}/export`);
  let fail = false;
  let reply!: ExportRecord;
  await page.route(`**${base}/exports`, async (route) => {
    if (route.request().method() === "POST") {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      reply = await response.json();
      fail = true;
      await route.fulfill({ response });
    } else if (fail)
      await route.fulfill({
        status: 503,
        json: { message: "出力履歴GET失敗" },
      });
    else await route.continue();
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await downloaded;
  await expect(page.getByRole("alert")).toContainText("出力履歴GET失敗");
  const name = Object.keys(reply.files).find((name) => name.endsWith(".json"))!;
  expect((await (await page.request.get(`${base}/exports`)).json())[0].id).toBe(
    reply.id,
  );
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  const again = page.waitForEvent("download");
  await page.getByRole("link", { name, exact: true }).click();
  await again;
  await page
    .locator("nav")
    .getByRole("link", { name: "プロジェクト", exact: true })
    .click();
  const card = page.locator(".project-list article").filter({
    has: page.getByRole("heading", {
      name: "Export reply proof",
      exact: true,
    }),
  });
  await expect(
    card.getByRole("link", { name: "最新Export r1", exact: true }),
  ).toBeVisible();
  fail = false;
  await card.getByRole("link", { name: "最新Export r1", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
});

test("Workspace saved revision reaches Overview even if parent query GET fails", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name: "Workspace shared cache proof" },
        useTaste: false,
      },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  await page.goto(`/projects/${project.id}/preview`);
  const slider = page.getByRole("slider", { name: "角丸", exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  let fail = false;
  await page.route(`**${base}`, async (route) => {
    if (fail && route.request().method() === "GET")
      await route.fulfill({
        status: 503,
        json: { message: "Project metadata GET失敗" },
      });
    else await route.continue();
  });
  await page.route(`**${base}/foundation/save`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    fail = true;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.locator(".editor-actions")).toContainText("設計 r2");
  await expect(slider).toBeEnabled();
  await page
    .locator("nav")
    .getByRole("link", { name: "概要・設計方針", exact: true })
    .click();
  expect((await (await page.request.get(base)).json()).current.revision).toBe(
    2,
  );
  await expect(page.locator(".editor-actions")).toContainText("設計 r2");
});

test("conversation successful reply displays despite following history GET failure", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Conversation cache proof" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  await page.goto(`/projects/${project.id}/foundation`);
  let fail = false;
  await page.route(`**${base}/conversations`, async (route) => {
    if (route.request().method() === "POST") {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      fail = true;
      await route.fulfill({ response });
    } else if (fail)
      await route.fulfill({
        status: 503,
        json: { message: "会話補助GET失敗" },
      });
    else await route.continue();
  });
  const text = "一覧の余白を少し広くしたい";
  await page.locator("#prompt").fill(text);
  await page.getByRole("button", { name: "提案を依頼", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "採用する", exact: true }),
  ).toBeEnabled();
  expect(
    (await (await page.request.get(`${base}/conversations`)).json()).at(-1)
      .text,
  ).toBe(text);
  await expect(
    page.locator(".conversation-content > p").filter({ hasText: text }),
  ).toBeVisible();
});

async function project(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name }, useTaste: false },
  });
  expect(response.ok()).toBeTruthy();
  const value = await response.json();
  return { id: value.id as string, base: `/api/projects/${value.id}` };
}
async function diffProject(page: Page, name: string) {
  const current = (await (await page.request.get("/api/profile")).json())
    .current;
  const first = await (
    await page.request.post("/api/profile", {
      data: {
        ...current.snapshot,
        baseProfileRevision: current.revision,
        answers: { "density-0": "a" },
      },
    })
  ).json();
  const value = await (
    await page.request.post("/api/projects", {
      data: {
        brief: { name },
        useTaste: true,
        sourceTasteProfileRevision: first.revision,
      },
    })
  ).json();
  await page.request.post("/api/profile", {
    data: {
      ...first.snapshot,
      baseProfileRevision: first.revision,
      answers: { "density-0": "b" },
    },
  });
  await page.goto(`/projects/${value.id}/overview`);
  await page.getByRole("button", { name: "差分を確認", exact: true }).click();
  await page
    .getByLabel("差分 answer:density-0", { exact: true })
    .selectOption("adopt");
  return { id: value.id as string, base: `/api/projects/${value.id}` };
}

test("adoption preserves dirty Overview input and keeps its stale base protected", async ({
  page,
}) => {
  const { id, base } = await diffProject(page, "Dirty adoption");
  await page
    .getByLabel("プロジェクト名", { exact: true })
    .fill("保持する未保存名");
  await page.route(`**${base}`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 503, json: { message: "補助GET失敗" } })
      : route.continue(),
  );
  await page
    .getByRole("button", {
      name: "選択を確定して新revisionを作成",
      exact: true,
    })
    .click();
  await expect(page.locator(".editor-actions")).toContainText("設計 r2");
  await expect(page.locator(".editor-actions")).toContainText("古い版");
  await expect(page.getByLabel("プロジェクト名", { exact: true })).toHaveValue(
    "保持する未保存名",
  );
  await expect(
    page.getByRole("button", { name: "概要・方針を保存", exact: true }),
  ).toBeDisabled();
  const draft = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`tasteprint.${id}.overview`)!),
    id,
  );
  expect(draft.baseRevision).toBe(1);
  expect(draft.brief.name).toBe("保持する未保存名");
  expect(
    (await (await page.request.get(base)).json()).current.snapshot.taste
      .answers["density-0"],
  ).toBe("b");
  await page.unroute(`**${base}`);
  await page.reload();
  await expect(page.getByLabel("プロジェクト名", { exact: true })).toHaveValue(
    "保持する未保存名",
  );
  await expect(page.locator(".editor-actions")).toContainText("古い版");
});

for (const kind of ["adopt", "promote"] as const) {
  test(`Overview ${kind} POST failure keeps choices until an explicit retry`, async ({
    page,
  }) => {
    const { base } =
      kind === "adopt"
        ? await diffProject(page, "Adopt failure")
        : await project(page, "Promote failure");
    let before: number;
    let button;
    if (kind === "promote") {
      const current = (await (await page.request.get(base)).json()).current;
      await page.request.post(base, {
        data: {
          baseRevision: 1,
          brief: current.snapshot.brief,
          policies: [
            {
              id: "own-failure",
              target: "list",
              text: "行を優先",
              reason: "比較する",
              sources: [],
              locked: false,
            },
          ],
        },
      });
      before = (await (await page.request.get("/api/profile")).json()).current
        .revision;
      await page.goto(`${base.replace("/api", "")}/overview`);
      await page.locator(".promotion-choice input").check();
      await page
        .getByLabel(
          "選択した原則・理由・出典を共通へ追加することを確認しました",
          { exact: true },
        )
        .check();
      button = page.getByRole("button", {
        name: "選択した判断を共通に追加",
        exact: true,
      });
    } else {
      before = 1;
      button = page.getByRole("button", {
        name: "選択を確定して新revisionを作成",
        exact: true,
      });
    }
    const endpoint = `**${base}/${kind === "adopt" ? "taste-diff" : "promote"}`;
    await page.route(endpoint, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { message: "確定更新500失敗" } })
        : route.continue(),
    );
    await button.click();
    await expect(
      page.locator(".editor-actions").getByRole("alert"),
    ).toContainText("確定更新500失敗");
    await expect(button).toBeEnabled();
    if (kind === "adopt") {
      await expect(
        page.getByLabel("差分 answer:density-0", { exact: true }),
      ).toHaveValue("adopt");
      expect(
        (await (await page.request.get(base)).json()).current.revision,
      ).toBe(before);
    } else {
      await expect(page.locator(".promotion-choice input")).toBeChecked();
      expect(
        (await (await page.request.get("/api/profile")).json()).current
          .revision,
      ).toBe(before);
    }
    await page.unroute(endpoint);
    await button.click();
    if (kind === "adopt")
      await expect(page.locator(".editor-actions")).toContainText("設計 r2");
    else {
      await expect(page.locator(".promotion-choice input")).not.toBeChecked();
      expect(
        (await (await page.request.get("/api/profile")).json()).current
          .revision,
      ).toBe(before + 1);
    }
    await expect(
      page.locator(".editor-actions").getByRole("alert"),
    ).toHaveCount(0);
  });
}

for (const kind of ["candidate", "restore", "review"] as const) {
  test(`Workspace ${kind} accepted reply reaches Overview despite failed Project GET`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { id, base } = await project(page, `Shared ${kind}`);
    let expected = 2;
    if (kind === "restore") {
      const current = (await (await page.request.get(base)).json()).current;
      const prepared = await page.request.post(`${base}/foundation/save`, {
        data: {
          baseRevision: 1,
          design: { ...current.design, radius: 7 },
          reason: "restore fixture",
          requestId: crypto.randomUUID(),
        },
      });
      expect(prepared.ok()).toBeTruthy();
      expected = 3;
    }
    await page.goto(
      `/projects/${id}/${kind === "review" ? "review" : "foundation"}`,
    );
    let action;
    if (kind === "candidate") {
      await page.locator("#prompt").fill("余白を広くする");
      await page
        .getByRole("button", { name: "提案を依頼", exact: true })
        .click();
      action = page.getByRole("button", { name: "採用する", exact: true });
      await expect(action).toBeEnabled();
    } else if (kind === "review") {
      await page
        .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
        .click();
      await expect(
        page.getByText("要判断の指摘数:", { exact: false }),
      ).toBeVisible({ timeout: 90000 });
      await page
        .getByRole("button", { name: "修正案を作成", exact: true })
        .click();
      await page
        .getByRole("button", { name: "仮Preview:", exact: false })
        .first()
        .click();
      action = page.getByRole("button", { name: "まとめて適用", exact: true });
    } else {
      await page.getByText("確定履歴（revision 2）", { exact: true }).click();
      action = page.getByRole("button", { name: "r1を復元", exact: true });
    }
    let fail = false;
    await page.route(`**${base}`, (route) =>
      fail && route.request().method() === "GET"
        ? route.fulfill({ status: 503, json: { message: "親Project GET失敗" } })
        : route.continue(),
    );
    await page.route(
      `**${base}/foundation/${kind === "restore" ? "restore" : "apply"}`,
      async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        fail = true;
        await route.fulfill({ response });
      },
    );
    await action.click();
    await expect(
      page.locator(kind === "review" ? ".save-status" : ".editor-actions"),
    ).toContainText(`設計 r${expected}`);
    await page
      .locator("nav")
      .getByRole("link", { name: "概要・設計方針", exact: true })
      .click();
    await expect(page.locator(".editor-actions")).toContainText(
      `設計 r${expected}`,
    );
    await expect(page.locator(".editor-actions")).not.toContainText("古い版");
    expect((await (await page.request.get(base)).json()).current.revision).toBe(
      expected,
    );
  });
}

test("a delayed archive from an unmounted list cannot undo a later unarchive", async ({
  page,
}) => {
  const a = await project(page, "Archive pending A");
  await project(page, "Archive refresh B");
  await page.goto("/projects");
  const card = (name: string) =>
    page
      .locator(".project-list article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  let release!: () => void, ready!: () => void, delivered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (ready = resolve));
  const finished = new Promise<void>((resolve) => (delivered = resolve));
  let first = true,
    failReads = false;
  await page.route("**/api/projects", (route) =>
    failReads && route.request().method() === "GET"
      ? route.fulfill({ status: 503, json: { message: "遅延応答後GET失敗" } })
      : route.continue(),
  );
  await page.route(`**${a.base}/archive`, async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    ready();
    await gate;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  try {
    await card("Archive pending A")
      .getByRole("button", { name: "アーカイブ", exact: true })
      .click();
    await started;
    await page
      .locator("nav")
      .getByRole("link", { name: "自分の好み", exact: true })
      .click();
    await page
      .locator("nav")
      .getByRole("link", { name: "プロジェクト", exact: true })
      .click();
    await card("Archive refresh B")
      .getByRole("button", { name: "アーカイブ", exact: true })
      .click();
    await expect(card("Archive pending A")).toHaveCount(0);
    await page.getByRole("button", { name: /^アーカイブ \(/ }).click();
    await card("Archive pending A")
      .getByRole("button", { name: "アーカイブ解除", exact: true })
      .click();
    await expect(card("Archive pending A")).toHaveCount(0);
    failReads = true;
    release();
    await finished;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.getByRole("button", { name: /^進行中 \(/ }).click();
    await expect(card("Archive pending A")).toBeVisible();
    expect(
      (await (await page.request.get(a.base)).json()).project.archivedAt,
    ).toBeNull();
  } finally {
    release();
  }
});

test("an older Project GET cannot undo a later Overview save in shared caches", async ({
  page,
}) => {
  const { id, base } = await project(page, "Old metadata read");
  await page.goto(`/projects/${id}/preview`);
  const slider = page.getByRole("slider", { name: "角丸", exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  let release!: () => void, ready!: () => void, delivered!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (ready = resolve));
  const finished = new Promise<void>((resolve) => (delivered = resolve));
  let first = true,
    failReads = false;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (!first)
      return failReads
        ? route.fulfill({
            status: 503,
            json: { message: "最新metadata GET失敗" },
          })
        : route.continue();
    first = false;
    const response = await route.fetch();
    ready();
    await gate;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  try {
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await started;
    await expect(slider).toBeEnabled();
    await page
      .locator("nav")
      .getByRole("link", { name: "概要・設計方針", exact: true })
      .click();
    await expect(page.locator(".editor-actions")).toContainText("設計 r2");
    await page
      .getByLabel("プロジェクト名", { exact: true })
      .fill("新しい確定名");
    failReads = true;
    await page
      .getByRole("button", { name: "概要・方針を保存", exact: true })
      .click();
    await expect(page.locator(".editor-actions")).toContainText("設計 r3");
    release();
    await finished;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator(".editor-actions")).toContainText("設計 r3");
    await expect(
      page.getByLabel("プロジェクト名", { exact: true }),
    ).toHaveValue("新しい確定名");
    await page
      .locator("nav")
      .getByRole("link", { name: "プロジェクト", exact: true })
      .click();
    const card = page.locator(".project-list article").filter({
      has: page.getByRole("heading", { name: "新しい確定名", exact: true }),
    });
    await expect(card).toContainText("設計 r3");
  } finally {
    release();
  }
});
