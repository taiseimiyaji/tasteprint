import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

async function openCreation(
  page: Page,
  width: number,
  name: string,
  useTaste = false,
) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/projects");
  await page
    .getByRole("button", { name: "新規プロジェクト", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("プロジェクト名", { exact: true }).fill(name);
  await dialog
    .getByLabel("共通の好みを使う", { exact: true })
    .setChecked(useTaste);
  const submit = dialog.getByRole("button", {
    name: "プロジェクトを作成",
    exact: true,
  });
  const recovery = dialog.getByRole("region", {
    name: "作成結果の確認",
    exact: true,
  });
  return { dialog, submit, recovery };
}
function countPosts(page: Page) {
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/projects"
    )
      posts++;
  });
  return () => posts;
}
async function namedProjects(page: Page, name: string) {
  return (await (await page.request.get("/api/projects")).json()).filter(
    (p: { brief: { name: string } }) => p.brief.name === name,
  );
}
async function record(page: Page, file: string, details: object) {
  mkdirSync("../evidence/project-create-unknown-ui", { recursive: true });
  await page.screenshot({
    path: `../evidence/project-create-unknown-ui/${file}.png`,
    fullPage: true,
  });
  writeFileSync(
    `../evidence/project-create-unknown-ui/${file}.json`,
    JSON.stringify(details, null, 2),
  );
}

for (const width of [1440, 390]) {
  test(`committed creation with lost reply stays locked through GET failure, late candidates and viewing at ${width}px`, async ({
    page,
  }) => {
    const name = `Committed unknown ${width}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const existing = [];
    for (let i = 0; i < 2; i++)
      existing.push(
        await (
          await page.request.post("/api/projects", {
            data: {
              brief: { name, purpose: `Existing independent ${i}` },
              useTaste: false,
            },
          })
        ).json(),
      );
    const f = await openCreation(page, width, name);
    const posts = countPosts(page);
    let acceptedId = "",
      failRead = true,
      holdRead = false;
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() === "POST") {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        acceptedId = (await response.json()).id;
        return route.fulfill({
          status: 503,
          json: { message: "Reply lost after commit" },
        });
      }
      if (failRead)
        return route.fulfill({
          status: 503,
          json: { message: "Candidate GET failed" },
        });
      const response = await route.fetch();
      if (holdRead) {
        entered();
        await gate;
      }
      await route.fulfill({ response });
    });
    await f.submit.click();
    await expect(f.recovery).toContainText("作成結果を確認できません");
    await expect(f.submit).toBeDisabled();
    expect(await namedProjects(page, name)).toHaveLength(3);
    await f.dialog
      .getByLabel("プロジェクト名", { exact: true })
      .fill(`Unsent later ${width}`);
    await f.dialog.getByLabel("プロジェクト名", { exact: true }).press("Enter");
    expect(posts()).toBe(1);
    await f.recovery
      .getByRole("button", { name: "一覧で候補を確認", exact: true })
      .click();
    await expect(f.recovery).toContainText("Candidate GET failed");
    await expect(f.submit).toBeDisabled();
    expect(posts()).toBe(1);
    failRead = false;
    holdRead = true;
    await f.recovery
      .getByRole("button", { name: "一覧で候補を確認", exact: true })
      .click();
    await started;
    try {
      await f.dialog
        .getByText("用途などを追加（任意）", { exact: true })
        .click();
      await f.dialog
        .getByLabel("用途", { exact: true })
        .fill("Later unsent purpose survives old GET");
      await expect(
        f.recovery.getByRole("button", { name: "候補を確認中…", exact: true }),
      ).toBeDisabled();
      await expect(f.submit).toBeDisabled();
      await f.dialog
        .getByLabel("プロジェクト名", { exact: true })
        .press("Enter");
      expect(posts()).toBe(1);
      await f.dialog
        .getByRole("button", { name: "閉じる", exact: true })
        .click();
      await page
        .getByRole("button", { name: "新規プロジェクト", exact: true })
        .click();
      await expect(f.submit).toBeDisabled();
    } finally {
      release();
    }
    await expect(f.recovery).toContainText("作成時と同じ名前の候補: 3件");
    await expect(f.recovery).toContainText(
      "同名でも今回の作成結果とは限りません",
    );
    await expect(
      f.dialog.getByLabel("プロジェクト名", { exact: true }),
    ).toHaveValue(`Unsent later ${width}`);
    await expect(f.dialog.getByLabel("用途", { exact: true })).toHaveValue(
      "Later unsent purpose survives old GET",
    );
    const candidate = f.recovery.locator(
      `a[href="/projects/${existing[0].id}/overview"]`,
    );
    await expect(candidate).toHaveAttribute("target", "_blank");
    const popupPromise = page.waitForEvent("popup");
    await candidate.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(
      new RegExp(`/projects/${existing[0].id}/overview`),
    );
    await expect(
      popup.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await popup.close();
    await expect(f.submit).toBeDisabled();
    const prepare = f.recovery.getByRole("button", {
      name: "現在の入力で別の作成を準備",
      exact: true,
    });
    await expect(prepare).toBeDisabled();
    await f.recovery
      .getByLabel("重複する可能性を確認し、別の作成を準備する", { exact: true })
      .check();
    await expect(f.submit).toBeDisabled();
    expect(posts()).toBe(1);
    // A later failed read must not reuse an acknowledgement of an older list.
    holdRead = false;
    failRead = true;
    await f.recovery
      .getByRole("button", { name: "一覧で候補を確認", exact: true })
      .click();
    await expect(f.recovery).toContainText("Candidate GET failed");
    await expect(prepare).toHaveCount(0);
    await expect(f.submit).toBeDisabled();
    failRead = false;
    await f.recovery
      .getByRole("button", { name: "一覧で候補を確認", exact: true })
      .click();
    await expect(f.recovery).toContainText("作成時と同じ名前の候補: 3件");
    await expect(prepare).toBeDisabled();
    await expect(
      f.dialog.getByLabel("プロジェクト名", { exact: true }),
    ).toHaveValue(`Unsent later ${width}`);
    await expect(f.dialog.getByLabel("用途", { exact: true })).toHaveValue(
      "Later unsent purpose survives old GET",
    );
    await f.recovery
      .getByLabel("重複する可能性を確認し、別の作成を準備する", { exact: true })
      .check();
    expect(posts()).toBe(1);
    await record(page, `candidates-${width}`, {
      width,
      acceptedId,
      candidateIds: existing.map((p) => p.id),
      posts: posts(),
      pageErrors: errors,
      fixture:
        "actual POST committed; only its browser reply replaced with 503; held GET retains later draft",
    });
    await prepare.click();
    await expect(f.submit).toBeEnabled();
    await expect(f.recovery).toHaveCount(0);
    expect(posts()).toBe(1);
    expect(await namedProjects(page, name)).toHaveLength(3);
    expect(await namedProjects(page, `Unsent later ${width}`)).toHaveLength(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("tasteprint.new-project")!),
      ),
    ).toMatchObject({
      name: `Unsent later ${width}`,
      purpose: "Later unsent purpose survives old GET",
    });
    expect(errors).toEqual([]);
  });

  test(`no candidates does not prove rejection or resend until an explicit separate creation at ${width}px`, async ({
    page,
  }) => {
    const name = `Uncommitted unknown ${width}`;
    const f = await openCreation(page, width, name),
      posts = countPosts(page);
    let attempts = 0;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      if (++attempts === 1)
        return route.fulfill({
          status: 500,
          json: { message: "Unknown before mutation" },
        });
      await route.continue();
    });
    await f.submit.click();
    await expect(f.submit).toBeDisabled();
    await f.dialog
      .getByLabel("プロジェクト名", { exact: true })
      .fill(`Separate intention ${width}`);
    await f.recovery
      .getByRole("button", { name: "一覧で候補を確認", exact: true })
      .click();
    await expect(f.recovery).toContainText("作成時と同じ名前の候補: 0件");
    await expect(f.recovery).toContainText(
      "作成されなかったことを保証しません",
    );
    await expect(f.submit).toBeDisabled();
    expect(posts()).toBe(1);
    await record(page, `empty-${width}`, {
      width,
      posts: posts(),
      actualNamedProjects: await namedProjects(page, name),
      fixture:
        "500 before server mutation; UI still does not infer uncommitted outcome from empty candidates",
    });
    await f.recovery
      .getByLabel("重複する可能性を確認し、別の作成を準備する", { exact: true })
      .check();
    await f.recovery
      .getByRole("button", { name: "現在の入力で別の作成を準備", exact: true })
      .click();
    await expect(f.submit).toBeEnabled();
    expect(posts()).toBe(1);
    await f.submit.click();
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/overview/);
    expect(posts()).toBe(2);
    expect(await namedProjects(page, name)).toHaveLength(0);
    expect(
      await namedProjects(page, `Separate intention ${width}`),
    ).toHaveLength(1);
  });
}

for (const [failure, width] of [
  ["network", 1440],
  ["invalid-json", 390],
  ["missing-id", 1440],
] as const)
  test(`committed creation ${failure} also blocks ordinary resend at ${width}px`, async ({
    page,
  }) => {
    const name = `Unknown reply ${failure}`,
      f = await openCreation(page, width, name),
      posts = countPosts(page);
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (failure === "network") return route.abort("failed");
      if (failure === "invalid-json")
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: "{",
        });
      await route.fulfill({ status: 201, json: {} });
    });
    await f.submit.click();
    await expect(f.recovery).toContainText("作成結果を確認できません");
    await expect(f.submit).toBeDisabled();
    await f.recovery
      .getByRole("button", { name: "一覧で候補を確認", exact: true })
      .click();
    await expect(f.recovery).toContainText("作成時と同じ名前の候補: 1件");
    await expect(f.submit).toBeDisabled();
    expect(posts()).toBe(1);
    expect(await namedProjects(page, name)).toHaveLength(1);
  });

for (const [status, width] of [
  [400, 1440],
  [409, 390],
] as const)
  test(`real creation API ${status} rejects before writing and permits a corrected retry at ${width}px`, async ({
    page,
  }) => {
    const name = `Known rejection ${status}`,
      f = await openCreation(page, width, name, status === 409),
      posts = countPosts(page);
    const before = (await (await page.request.get("/api/projects")).json())
      .length;
    if (status === 400) {
      let first = true;
      await page.route("**/api/projects", async (route) => {
        if (route.request().method() !== "POST" || !first)
          return route.continue();
        first = false;
        const body = route.request().postDataJSON();
        // Only request brief is a fixture; real endpoint validates/rejects it.
        const response = await route.fetch({
          postData: JSON.stringify({
            ...body,
            brief: { ...body.brief, name: "" },
          }),
        });
        expect(response.status()).toBe(400);
        await route.fulfill({ response });
      });
    } else {
      const current = (await (await page.request.get("/api/profile")).json())
        .current;
      const saved = await page.request.post("/api/profile", {
        data: {
          baseProfileRevision: current.revision,
          answers: {},
          reasons: {},
          principles: [],
        },
      });
      expect(saved.ok()).toBe(true);
    }
    await f.submit.click();
    await expect(f.dialog.getByRole("alert")).toBeVisible();
    await expect(f.submit).toBeEnabled();
    await expect(f.recovery).toHaveCount(0);
    expect(
      (await (await page.request.get("/api/projects")).json()).length,
    ).toBe(before);
    await expect(
      f.dialog.getByLabel("プロジェクト名", { exact: true }),
    ).toHaveValue(name);
    if (status === 409)
      await f.dialog.getByLabel("共通の好みを使う", { exact: true }).uncheck();
    await f.submit.click();
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/overview/);
    expect(posts()).toBe(2);
    expect(await namedProjects(page, name)).toHaveLength(1);
  });
