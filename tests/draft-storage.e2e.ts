import { test, expect, type Page } from "@playwright/test";
type StorageProbe = typeof window & {
  draftReadBlocked: boolean;
  draftWriteBlocked: boolean;
  draftStored: () => string | null;
  draftWrites: string[];
};
const kinds = [
  "workspace",
  "profile",
  "overview",
  "new-project",
  "reference",
  "position",
  "use-taste",
] as const;
type Kind = (typeof kinds)[number];
async function fixture(
  page: Page,
  kind: Kind,
  active = false,
  malformed = false,
  readable = false,
) {
  const p = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: `Unread draft ${kind}` }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${p.id}`;
  const current = (await (await page.request.get(`${base}/foundation`)).json())
    .current;
  const profile = (await (await page.request.get("/api/profile")).json())
    .current;
  let key = "",
    value: unknown,
    path = "/projects",
    label = "";
  if (kind === "workspace") {
    key = `tasteprint.scope.${p.id}.draft.v1`;
    value = {
      version: 2,
      design: { ...current.design, accent: "#112233" },
      answers: {},
      references: [],
      baseRevision: 1,
    };
    path = `/projects/${p.id}/foundation`;
    label = "設計";
  }
  if (kind === "profile") {
    key = "tasteprint.profile.draft";
    value = {
      baseProfileRevision: profile.revision,
      ...profile.snapshot,
      principles: [
        {
          id: crypto.randomUUID(),
          target: "list",
          text: "UNREAD_PRINCIPLE",
          reason: "keep",
          sources: [],
          locked: false,
        },
      ],
    };
    path = "/profile";
    label = "共通の好み";
  }
  if (kind === "position") {
    key = "tasteprint.profile.position";
    value = 5;
    path = "/profile";
    label = "比較位置";
  }
  if (kind === "overview") {
    key = `tasteprint.${p.id}.overview`;
    value = {
      baseRevision: 1,
      brief: { ...current.snapshot.brief, name: "UNREAD_PROJECT_NAME" },
      policies: [],
    };
    path = `/projects/${p.id}/overview`;
    label = "概要・方針";
  }
  if (kind === "new-project") {
    key = "tasteprint.new-project";
    value = {
      name: "UNREAD_NEW_PROJECT",
      purpose: "keep",
      audience: "",
      desired: "",
      avoid: "",
    };
    label = "新規プロジェクト";
  }
  if (kind === "use-taste") {
    key = "tasteprint.new-project.use-taste";
    value = false;
    label = "共通の好みの使用";
  }
  if (kind === "reference") {
    const r = await (
      await page.request.post(`${base}/references`, {
        data: {
          name: "Unread reference",
          url: active ? "https://example.com/e2e-pending" : "",
          selections: [{ aspect: "Typography", intent: "reference" }],
          likes: "",
          dislikes: "",
        },
      })
    ).json();
    if (active) {
      const job = await page.request.post(`${base}/references/${r.id}/jobs`, {
        data: { version: r.version, type: "capture", key: crypto.randomUUID() },
      });
      expect(job.ok()).toBe(true);
    }
    key = `tasteprint.${p.id}.reference.${r.id}`;
    value = {
      name: r.name,
      url: r.url,
      selections: r.selections,
      likes: "UNREAD_REFERENCE_NOTE",
      dislikes: "",
      baseVersion: r.version,
    };
    path = `/projects/${p.id}/inspiration`;
    label = r.name;
  }
  const invalid =
    kind === "position"
      ? 1.5
      : kind === "use-taste"
        ? "false"
        : kind === "profile" || kind === "overview"
          ? {}
          : kind === "workspace"
            ? { ...(value as object), baseRevision: "one" }
            : kind === "reference"
              ? { ...(value as object), selections: { broken: true } }
              : { ...(value as object), name: [] };
  const stored = JSON.stringify(malformed ? invalid : value);
  await page.addInitScript(
    ({ key, stored, malformed, readable }) => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      set.call(localStorage, key, stored);
      const state = window as StorageProbe;
      state.draftReadBlocked = !malformed && !readable;
      state.draftWriteBlocked = false;
      state.draftWrites = [];
      state.draftStored = () => get.call(localStorage, key);
      Storage.prototype.getItem = function (candidate) {
        if (candidate === key && state.draftReadBlocked)
          throw new DOMException("Draft read denied", "SecurityError");
        return get.call(this, candidate);
      };
      Storage.prototype.setItem = function (candidate, content) {
        if (candidate === key) {
          state.draftWrites.push(content);
          if (state.draftWriteBlocked)
            throw new DOMException("Draft write denied", "SecurityError");
        }
        return set.call(this, candidate, content);
      };
    },
    { key, stored, malformed, readable },
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let updates = 0;
  await page.route("**/api/**", (route) => {
    if (
      !["GET", "HEAD"].includes(route.request().method()) &&
      !route.request().url().endsWith("/migration/browser")
    )
      updates++;
    return route.continue();
  });
  await page.goto(path);
  if (["new-project", "use-taste"].includes(kind))
    await page
      .getByRole("button", { name: "新規プロジェクト", exact: true })
      .click();
  if (kind === "profile")
    await page.getByRole("button", { name: "DNA・原則", exact: true }).click();
  const warning = page
    .getByRole("alert")
    .filter({ hasText: `${label}の下書きを読み込めません` });
  if (readable) await expect(warning).toHaveCount(0);
  else await expect(warning).toBeVisible();
  const input =
    kind === "workspace"
      ? page.getByLabel("accent", { exact: true })
      : kind === "overview" || kind === "new-project"
        ? page.getByLabel("プロジェクト名", { exact: true })
        : kind === "reference"
          ? page.getByRole("textbox", { name: "好きな点", exact: true })
          : kind === "position"
            ? page.getByLabel("質問を選ぶ", { exact: true })
            : kind === "use-taste"
              ? page.getByRole("checkbox", {
                  name: "共通の好みを使う",
                  exact: true,
                })
              : page.getByRole("button", { name: "原則を追加", exact: true });
  return {
    p,
    base,
    key,
    stored,
    value,
    label,
    warning,
    input,
    errors,
    updates: () => updates,
    profileRevision: profile.revision,
  };
}
for (const kind of kinds) {
  test(`${kind} malformed JSON shape keeps the original bytes and recovers after explicit reread`, async ({
    page,
  }) => {
    const f = await fixture(page, kind, false, true);
    await expect(f.input).toBeDisabled();
    expect(
      await page.evaluate(() => (window as StorageProbe).draftStored()),
    ).toBe(f.stored);
    expect(
      await page.evaluate(() => (window as StorageProbe).draftWrites),
    ).toEqual([]);
    const reread = page.getByRole("button", {
      name: `${f.label}の下書きを再読込`,
      exact: true,
    });
    await reread.click();
    await expect(f.warning).toBeVisible();
    expect(
      await page.evaluate(() => (window as StorageProbe).draftStored()),
    ).toBe(f.stored);
    expect(
      await page.evaluate(() => (window as StorageProbe).draftWrites),
    ).toEqual([]);
    expect(f.updates()).toBe(0);
    await page.evaluate(
      ({ key, value }) => {
        // Simulate restoring the stored file, separately from the blocked editor.
        localStorage.setItem(key, JSON.stringify(value));
        (window as StorageProbe).draftWrites = [];
      },
      { key: f.key, value: f.value },
    );
    await expect(f.warning).toBeVisible();
    await reread.click();
    await expect(f.warning).toHaveCount(0);
    await expect(f.input).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse((window as StorageProbe).draftStored()!),
        ),
      )
      .toEqual(f.value);
    expect(f.updates()).toBe(0);
    expect(f.errors).toEqual([]);
  });
  test(`${kind} unread draft makes no writes and recovers only after a successful explicit reread`, async ({
    page,
  }) => {
    const f = await fixture(page, kind);
    await expect(f.input).toBeDisabled();
    expect(
      await page.evaluate(() => (window as StorageProbe).draftStored()),
    ).toBe(f.stored);
    expect(
      await page.evaluate(() => (window as StorageProbe).draftWrites),
    ).toEqual([]);
    await page
      .getByRole("button", { name: `${f.label}の下書きを再読込`, exact: true })
      .click();
    await expect(f.warning).toBeVisible();
    expect(
      await page.evaluate(() => (window as StorageProbe).draftWrites),
    ).toEqual([]);
    if (kind === "workspace")
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        await f.warning.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/unread-draft-${width}.png`,
        });
      }
    await page.evaluate(() => {
      (window as StorageProbe).draftReadBlocked = false;
    });
    await page
      .getByRole("button", { name: `${f.label}の下書きを再読込`, exact: true })
      .click();
    await expect(f.warning).toHaveCount(0);
    await expect(f.input).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse((window as StorageProbe).draftStored()!),
        ),
      )
      .toEqual(f.value);
    if (kind === "workspace") {
      await expect(f.input).toHaveValue("#112233");
      await f.input.fill("#334455");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse((window as StorageProbe).draftStored()!).design.accent,
          ),
        )
        .toBe("#334455");
    }
    if (kind === "overview" || kind === "new-project")
      await expect(f.input).toHaveValue(
        kind === "overview" ? "UNREAD_PROJECT_NAME" : "UNREAD_NEW_PROJECT",
      );
    if (kind === "reference")
      await expect(f.input).toHaveValue("UNREAD_REFERENCE_NOTE");
    if (kind === "profile")
      await expect(page.getByLabel("原則", { exact: true })).toHaveValue(
        "UNREAD_PRINCIPLE",
      );
    if (kind === "position") await expect(f.input).toHaveValue("5");
    if (kind === "use-taste") await expect(f.input).not.toBeChecked();
    expect(f.updates()).toBe(0);
    if (kind === "workspace" || kind === "overview") {
      await page
        .getByRole("button", {
          name: kind === "workspace" ? "変更を保存" : "概要・方針を保存",
          exact: true,
        })
        .click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`${f.base}/foundation`)).json())
              .current.revision,
        )
        .toBe(2);
      const r = (await (await page.request.get(`${f.base}/foundation`)).json())
        .current;
      expect(
        kind === "workspace" ? r.design.accent : r.snapshot.brief.name,
      ).toBe(kind === "workspace" ? "#334455" : "UNREAD_PROJECT_NAME");
      expect(f.updates()).toBe(1);
    } else if (kind === "profile") {
      await page
        .getByRole("button", { name: "共通の好みを保存", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get("/api/profile")).json()).current
              .revision,
        )
        .toBe(f.profileRevision + 1);
      const r = (await (await page.request.get("/api/profile")).json()).current;
      expect(
        r.snapshot.principles.some(
          (p: { text: string }) => p.text === "UNREAD_PRINCIPLE",
        ),
      ).toBe(true);
      expect(f.updates()).toBe(1);
    } else if (kind === "reference") {
      await page
        .getByRole("button", { name: "観点・メモを保存", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`${f.base}/references`)).json())
              .references[0].version,
        )
        .toBe(2);
      const r = (await (await page.request.get(`${f.base}/references`)).json())
        .references[0];
      expect(r.likes).toBe("UNREAD_REFERENCE_NOTE");
      expect(f.updates()).toBe(1);
    }
    expect(f.errors).toEqual([]);
  });
  test(`${kind} explicit replacement permits normal editing without an unread overwrite on mount`, async ({
    page,
  }) => {
    const f = await fixture(page, kind);
    expect(
      await page.evaluate(() => (window as StorageProbe).draftWrites),
    ).toEqual([]);
    await page
      .getByRole("button", {
        name: `${f.label}の下書きを表示中の内容で置き換える`,
        exact: true,
      })
      .click();
    await expect(f.warning).toHaveCount(0);
    await expect(f.input).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() => (window as StorageProbe).draftWrites.length),
      )
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() => (window as StorageProbe).draftStored()),
    ).not.toBe(f.stored);
    if (kind === "workspace") await f.input.fill("#445566");
    else if (["overview", "new-project", "reference"].includes(kind))
      await f.input.fill("Explicit replacement edit");
    else if (kind === "position") await f.input.selectOption("3");
    else if (kind === "use-taste") await f.input.uncheck();
    else {
      await f.input.click();
      await page
        .getByLabel("原則", { exact: true })
        .last()
        .fill("Explicit principle");
    }
    expect(f.updates()).toBe(0);
    expect(f.errors).toEqual([]);
  });
}

for (const kind of ["profile", "reference"] as const)
  test(`${kind} malformed draft is replaced only by the explicit recovery action`, async ({
    page,
  }) => {
    const f = await fixture(page, kind, false, true);
    expect(
      await page.evaluate(() => (window as StorageProbe).draftStored()),
    ).toBe(f.stored);
    expect(
      await page.evaluate(() => (window as StorageProbe).draftWrites),
    ).toEqual([]);
    await page
      .getByRole("button", {
        name: `${f.label}の下書きを表示中の内容で置き換える`,
        exact: true,
      })
      .click();
    await expect(f.warning).toHaveCount(0);
    await expect(f.input).toBeEnabled();
    if (kind === "reference") {
      await f.input.fill("Explicit restored note");
      await page
        .getByRole("button", { name: "観点・メモを保存", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get(`${f.base}/references`)).json())
              .references[0].likes,
        )
        .toBe("Explicit restored note");
    } else {
      await f.input.click();
      await page
        .getByLabel("原則", { exact: true })
        .last()
        .fill("Explicit restored principle");
      await page
        .getByRole("button", { name: "共通の好みを保存", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get("/api/profile")).json()).current
              .revision,
        )
        .toBe(f.profileRevision + 1);
    }
    expect(f.updates()).toBe(1);
    expect(f.errors).toEqual([]);
  });

test("unread Reference draft still allows an active Mock job to be canceled before reread recovery", async ({
  page,
}) => {
  const f = await fixture(page, "reference", true);
  const reread = page.getByRole("button", {
    name: `${f.label}の下書きを再読込`,
    exact: true,
  });
  await expect(reread).toBeDisabled();
  const cancel = page.getByRole("button", { name: "中断する", exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(
    page.getByText("URL取得: 中断済み", { exact: true }),
  ).toBeVisible();
  await expect(reread).toBeEnabled();
  expect(
    await page.evaluate(() => (window as StorageProbe).draftStored()),
  ).toBe(f.stored);
  expect(
    await page.evaluate(() => (window as StorageProbe).draftWrites),
  ).toEqual([]);
  await page.evaluate(() => {
    (window as StorageProbe).draftReadBlocked = false;
  });
  await reread.click();
  await expect(f.input).toBeEnabled();
  await expect(f.input).toHaveValue("UNREAD_REFERENCE_NOTE");
  expect(f.updates()).toBe(1);
  expect(f.errors).toEqual([]);
});

test("Workspace reads a draft design and its old base together even when any later storage read would fail", async ({
  page,
}) => {
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Atomic draft base" }, useTaste: false },
    })
  ).json();
  const base = `/api/projects/${project.id}`;
  const r1 = (await (await page.request.get(`${base}/foundation`)).json())
    .current;
  const saved = await page.request.post(`${base}/foundation/save`, {
    data: {
      baseRevision: 1,
      design: { ...r1.design, accent: "#778899" },
      reason: "newer external revision",
      requestId: crypto.randomUUID(),
    },
  });
  expect(saved.ok()).toBe(true);
  const key = `tasteprint.scope.${project.id}.draft.v1`;
  const stored = {
    version: 2,
    design: { ...r1.design, accent: "#112233" },
    answers: {},
    references: [],
    baseRevision: 1,
  };
  await page.addInitScript(
    ({ key, stored }) => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem;
      set.call(localStorage, key, JSON.stringify(stored));
      let reads = 0;
      (window as StorageProbe).draftStored = () => get.call(localStorage, key);
      Storage.prototype.getItem = function (candidate) {
        // React StrictMode repeats the one initializer in development. A separate
        // base initializer would make later reads and lose the original base.
        if (candidate === key && ++reads > 2)
          throw new DOMException("Later read denied", "SecurityError");
        return get.call(this, candidate);
      };
    },
    { key, stored },
  );
  await page.goto(`/projects/${project.id}/foundation`);
  await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
    "#112233",
  );
  await expect(
    page.getByRole("button", { name: "変更を保存", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".editor-actions")).toContainText(
    "下書きの版が古くなっています",
  );
  expect(
    JSON.parse(
      (await page.evaluate(() => (window as StorageProbe).draftStored()))!,
    ).baseRevision,
  ).toBe(1);
  const current = (await (await page.request.get(`${base}/foundation`)).json())
    .current;
  expect(current.revision).toBe(2);
  expect(current.design.accent).toBe("#778899");
});

test("Profile incomplete principles, whitespace and snapshot metadata survive draft reload without a save", async ({
  page,
}) => {
  const current = (await (await page.request.get("/api/profile")).json())
    .current;
  const value = {
    baseProfileRevision: current.revision,
    ...current.snapshot,
    principles: [
      {
        id: "unfinished-profile-draft",
        target: "",
        text: "",
        reason: `  ${"x".repeat(2100)}  `,
        sources: Array.from({ length: 40 }, (_, i) => ` source ${i} `),
        locked: false,
      },
    ],
    futureMetadata: { keep: "snapshot context" },
  };
  await page.addInitScript((value) => {
    localStorage.setItem("tasteprint.projects.migrated.v1", "complete");
    localStorage.setItem("tasteprint.profile.draft", JSON.stringify(value));
  }, value);
  let saves = 0;
  page.context().on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/profile"))
      saves++;
  });
  await page.goto("/profile");
  await page.getByRole("button", { name: "DNA・原則", exact: true }).click();
  await expect(page.getByLabel("原則", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("理由", { exact: true })).toHaveValue(
    value.principles[0].reason,
  );
  // A new page has no page init fixture and reads the app's persisted draft.
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("tasteprint.profile.draft")!),
      ),
    )
    .toEqual(value);
  const restored = await page.context().newPage();
  await restored.goto("/profile");
  await restored
    .getByRole("button", { name: "DNA・原則", exact: true })
    .click();
  await expect(restored.getByLabel("原則", { exact: true })).toHaveValue("");
  await expect(restored.getByLabel(/^必要な出典（1行に1件）/)).toHaveValue(
    value.principles[0].sources.join("\n"),
  );
  expect(
    await restored.evaluate(() =>
      JSON.parse(localStorage.getItem("tasteprint.profile.draft")!),
    ),
  ).toEqual(value);
  await expect(
    restored.getByText("Something went wrong!", { exact: true }),
  ).toHaveCount(0);
  expect(saves).toBe(0);
  await restored.close();
});

function tabValue(kind: Kind, original: unknown, marker: string): unknown {
  const value: any = structuredClone(original);
  if (kind === "workspace") value.design.accent = marker;
  else if (kind === "profile") value.principles[0].text = marker;
  else if (kind === "overview") value.brief.name = marker;
  else if (kind === "new-project") value.name = marker;
  else if (kind === "reference") value.likes = marker;
  else if (kind === "position") return Number(marker);
  else return marker === "true";
  return value;
}
function draftInput(
  page: Page,
  kind: Kind,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  return kind === "profile"
    ? page.getByLabel("原則", { exact: true })
    : f.input;
}
async function expectDraftInput(
  input: ReturnType<typeof draftInput>,
  kind: Kind,
  value: any,
) {
  if (kind === "use-taste") {
    if (value) await expect(input).toBeChecked();
    else await expect(input).not.toBeChecked();
  } else await expect(input).toHaveValue(String(value));
}
for (const width of [1440, 390])
  for (const kind of kinds) {
    test(`${kind} observed other-tab draft stays intact until explicit reread or replacement at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      const f = await fixture(page, kind, false, false, true);
      const input = draftInput(page, kind, f);
      await expect(input).toBeEnabled();
      const original = await page.evaluate(() =>
        (window as StorageProbe).draftStored(),
      );
      const second = await context.newPage();
      await second.goto("/preview-render");
      const otherMarker =
        kind === "workspace"
          ? "#334455"
          : kind === "position"
            ? "8"
            : kind === "use-taste"
              ? "true"
              : "OTHER_TAB_DRAFT";
      const other = tabValue(kind, JSON.parse(original!), otherMarker),
        raw = JSON.stringify(other);
      const conflict = page.getByRole("alert").filter({
        hasText: `${f.label}の下書きが別タブ・別画面で変更されています`,
      });
      await page.evaluate(() => ((window as StorageProbe).draftWrites = []));
      await second.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key: f.key,
        raw,
      });
      await expect(conflict).toBeVisible();
      await expect(input).toBeDisabled();
      expect(
        await page.evaluate(() => (window as StorageProbe).draftStored()),
      ).toBe(raw);
      expect(
        await page.evaluate(() => (window as StorageProbe).draftWrites),
      ).toEqual([]);
      await expect(conflict).toContainText(
        "再読込すると、この画面の入力を別タブの下書きで置き換えます",
      );
      await page
        .getByRole("button", {
          name: `${f.label}の下書きを再読込`,
          exact: true,
        })
        .click();
      await expect(conflict).toHaveCount(0);
      await expect(input).toBeEnabled();
      await expectDraftInput(
        input,
        kind,
        kind === "use-taste" ? true : otherMarker,
      );
      const ownMarker =
        kind === "workspace"
          ? "#aabbcc"
          : kind === "position"
            ? "3"
            : kind === "use-taste"
              ? "false"
              : "THIS_TAB_INPUT";
      if (kind === "use-taste") await input.uncheck();
      else if (kind === "position") await input.selectOption(ownMarker);
      else await input.fill(ownMarker);
      const own = tabValue(kind, other, ownMarker);
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.parse((window as StorageProbe).draftStored()!),
          ),
        )
        .toEqual(own);
      const another = tabValue(
        kind,
        other,
        kind === "position"
          ? "9"
          : kind === "workspace"
            ? "#778899"
            : kind === "use-taste"
              ? "true"
              : "ANOTHER_TAB_INPUT",
      );
      const anotherRaw = JSON.stringify(another);
      await second.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key: f.key,
        raw: anotherRaw,
      });
      await expect(conflict).toBeVisible();
      await expect(input).toBeDisabled();
      await expectDraftInput(
        input,
        kind,
        kind === "use-taste" ? false : ownMarker,
      );
      expect(
        await page.evaluate(() => (window as StorageProbe).draftStored()),
      ).toBe(anotherRaw);
      await page
        .getByRole("button", {
          name: `${f.label}の下書きを表示中の内容で置き換える`,
          exact: true,
        })
        .click();
      await expect(conflict).toHaveCount(0);
      await expect(input).toBeEnabled();
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.parse((window as StorageProbe).draftStored()!),
          ),
        )
        .toEqual(own);
      expect(f.updates()).toBe(0);
      expect(f.errors).toEqual([]);
      expect(
        (await (await page.request.get(`${f.base}/foundation`)).json()).current
          .revision,
      ).toBe(1);
      await second.close();
    });
  }
for (const width of [1440, 390])
  test(`write-time check protects a changed draft without a storage notification at ${width}`, async ({
    page,
    context,
  }) => {
    await page.addInitScript(() =>
      window.addEventListener(
        "storage",
        (e) => e.stopImmediatePropagation(),
        true,
      ),
    );
    await page.setViewportSize({ width, height: 1050 });
    const f = await fixture(page, "workspace", false, false, true);
    const second = await context.newPage();
    await second.goto("/preview-render");
    const other = tabValue("workspace", f.value, "#445566"),
      raw = JSON.stringify(other);
    await second.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
      key: f.key,
      raw,
    });
    await f.input.fill("#abcdef");
    const conflict = page
      .getByRole("alert")
      .filter({ hasText: "設計の下書きが別タブ・別画面で変更されています" });
    await expect(conflict).toBeVisible();
    await expect(f.input).toHaveValue("#abcdef");
    await expect(f.input).toBeDisabled();
    expect(
      await page.evaluate(() => (window as StorageProbe).draftStored()),
    ).toBe(raw);
    expect(f.updates()).toBe(0);
    await second.close();
  });
for (const clear of [false, true])
  test(`other-tab ${clear ? "clear" : "remove"} blocks autosave and explicit replacement keeps this input`, async ({
    page,
    context,
  }) => {
    const f = await fixture(page, "workspace", false, false, true);
    const second = await context.newPage();
    await second.goto("/preview-render");
    await second.evaluate(
      ({ key, clear }) =>
        clear ? localStorage.clear() : localStorage.removeItem(key),
      { key: f.key, clear },
    );
    const conflict = page
      .getByRole("alert")
      .filter({ hasText: "設計の下書きが別タブ・別画面で変更されています" });
    await expect(conflict).toBeVisible();
    await expect(f.input).toHaveValue("#112233");
    expect(
      await page.evaluate(() => (window as StorageProbe).draftStored()),
    ).toBeNull();
    await page
      .getByRole("button", {
        name: "設計の下書きを表示中の内容で置き換える",
        exact: true,
      })
      .click();
    await expect(f.input).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse((window as StorageProbe).draftStored()!).design.accent,
        ),
      )
      .toBe("#112233");
    expect(f.updates()).toBe(0);
    await second.close();
  });
test("other-scope and sessionStorage changes keep normal draft editing available", async ({
  page,
  context,
}) => {
  const f = await fixture(page, "workspace", false, false, true);
  const second = await context.newPage();
  await second.goto("/preview-render");
  await second.evaluate((key) => {
    localStorage.setItem("tasteprint.another-scope.draft", "other");
    sessionStorage.setItem(key, "session only");
  }, f.key);
  await f.input.fill("#abcdef");
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse((window as StorageProbe).draftStored()!).design.accent,
      ),
    )
    .toBe("#abcdef");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(f.updates()).toBe(0);
  await second.close();
});

for (const width of [1440, 390])
  test(`actual Foundation two-tab edits preserve both inputs and require explicit recovery at ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const f = await fixture(page, "workspace", false, false, true);
    const second = await context.newPage();
    await second.setViewportSize({ width, height: 1050 });
    await second.goto(`/projects/${f.p.id}/foundation`);
    const otherInput = second.getByRole("textbox", {
      name: "accent",
      exact: true,
    });
    await expect(otherInput).toHaveValue("#112233");
    await f.input.fill("#224466");
    const otherWarning = second
      .getByRole("alert")
      .filter({ hasText: "設計の下書きが別タブ・別画面で変更されています" });
    await expect(otherWarning).toBeVisible();
    await expect(otherInput).toBeDisabled();
    await expect(otherInput).toHaveValue("#112233");
    await second
      .getByRole("button", { name: "設計の下書きを再読込", exact: true })
      .click();
    await expect(otherInput).toHaveValue("#224466");
    await otherInput.fill("#445566");
    const firstWarning = page
      .getByRole("alert")
      .filter({ hasText: "設計の下書きが別タブ・別画面で変更されています" });
    await expect(firstWarning).toBeVisible();
    await expect(f.input).toHaveValue("#224466");
    await expect(f.input).toBeDisabled();
    await expect(
      page.getByRole("textbox", { name: "ink", exact: true }),
    ).toBeDisabled();
    const before = await second.evaluate(
      (key) => localStorage.getItem(key),
      f.key,
    );
    expect(JSON.parse(before!).design.accent).toBe("#445566");
    await second.close();
    await page
      .getByRole("button", { name: "設計の下書きを再読込", exact: true })
      .click();
    await expect(f.input).toHaveValue("#445566");
    await page.getByRole("button", { name: "変更を保存", exact: true }).click();
    await expect(page.locator(".editor-actions")).toContainText(
      "保存済み · 設計 r2",
    );
    const saved = (
      await (await page.request.get(`${f.base}/foundation`)).json()
    ).current;
    expect(saved.design.accent).toBe("#445566");
    expect(saved.revision).toBe(2);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse((window as StorageProbe).draftStored()!).baseRevision,
        ),
      )
      .toBe(2);
    // The fixture's page init seeds its starting draft on every load. A fresh
    // page has no seed and exercises the application's actual persisted bytes.
    await page.close();
    const resumed = await context.newPage();
    await resumed.goto(`/projects/${f.p.id}/foundation`);
    await expect(
      resumed.getByRole("textbox", { name: "accent", exact: true }),
    ).toHaveValue("#445566");
    await expect(resumed.getByRole("alert")).toHaveCount(0);
    await resumed.close();
  });

for (const failure of ["read", "shape"] as const)
  for (const width of [1440, 390])
    test(`conflict reread ${failure} failure keeps this input until explicit recovery at ${width}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 1050 });
      const f = await fixture(page, "workspace", false, false, true);
      await f.input.fill("#abcdef");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse((window as StorageProbe).draftStored()!).design.accent,
          ),
        )
        .toBe("#abcdef");
      const second = await context.newPage();
      await second.goto("/preview-render");
      const validRaw = JSON.stringify(
        tabValue("workspace", f.value, "#445566"),
      );
      const raw = failure === "shape" ? '{"broken":true}' : validRaw;
      await second.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key: f.key,
        raw,
      });
      const conflict = page
        .getByRole("alert")
        .filter({ hasText: "設計の下書きが別タブ・別画面で変更されています" });
      await expect(conflict).toBeVisible();
      if (failure === "read")
        await page.evaluate(
          () => ((window as StorageProbe).draftReadBlocked = true),
        );
      await page.evaluate(() => ((window as StorageProbe).draftWrites = []));
      await page
        .getByRole("button", { name: "設計の下書きを再読込", exact: true })
        .click();
      await expect(f.input).toHaveValue("#abcdef");
      await expect(f.input).toBeDisabled();
      await expect(conflict).toBeVisible();
      expect(
        await page.evaluate(() => (window as StorageProbe).draftStored()),
      ).toBe(raw);
      expect(
        await page.evaluate(() => (window as StorageProbe).draftWrites),
      ).toEqual([]);
      await page
        .getByRole("button", {
          name: "設計の下書きを表示中の内容で置き換える",
          exact: true,
        })
        .click();
      await expect(f.input).toBeEnabled();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse((window as StorageProbe).draftStored()!).design.accent,
          ),
        )
        .toBe("#abcdef");
      await page.evaluate(
        () => ((window as StorageProbe).draftReadBlocked = false),
      );
      await second.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key: f.key,
        raw: validRaw,
      });
      await expect(conflict).toBeVisible();
      await page
        .getByRole("button", { name: "設計の下書きを再読込", exact: true })
        .click();
      await expect(f.input).toHaveValue("#445566");
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(f.updates()).toBe(0);
      await second.close();
    });

test("failed explicit replacement cannot authorize a later automatic overwrite after quota recovery", async ({
  page,
  context,
}) => {
  await page.addInitScript(() =>
    window.addEventListener(
      "storage",
      (e) => e.stopImmediatePropagation(),
      true,
    ),
  );
  const f = await fixture(page, "workspace", false, false, true);
  const second = await context.newPage();
  await second.goto("/preview-render");
  const otherRaw = JSON.stringify(tabValue("workspace", f.value, "#445566"));
  await second.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: f.key,
    raw: otherRaw,
  });
  await f.input.fill("#abcdef");
  const conflict = page
    .getByRole("alert")
    .filter({ hasText: "設計の下書きが別タブ・別画面で変更されています" });
  await expect(conflict).toBeVisible();
  await page.evaluate(
    () => ((window as StorageProbe).draftWriteBlocked = true),
  );
  await page
    .getByRole("button", {
      name: "設計の下書きを表示中の内容で置き換える",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".editor-actions").getByRole("alert"),
  ).toContainText("下書きを保存できません");
  await expect(f.input).toBeEnabled();
  expect(
    await page.evaluate(() => (window as StorageProbe).draftStored()),
  ).toBe(otherRaw);
  const newestRaw = JSON.stringify(tabValue("workspace", f.value, "#778899"));
  await second.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: f.key,
    raw: newestRaw,
  });
  await page.evaluate(
    () => ((window as StorageProbe).draftWriteBlocked = false),
  );
  await f.input.fill("#ddeeff");
  await expect(conflict).toBeVisible();
  await expect(f.input).toHaveValue("#ddeeff");
  await expect(f.input).toBeDisabled();
  expect(
    await page.evaluate(() => (window as StorageProbe).draftStored()),
  ).toBe(newestRaw);
  expect(f.updates()).toBe(0);
  await second.close();
});
