import { test, expect, type Page } from "@playwright/test";
import type { Candidate } from "../src/client/foundation-api";
function gate() {
  let release!: () => void, enter!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const entered = new Promise<void>((resolve) => (enter = resolve));
  return { held, entered, release, enter };
}
async function setup(page: Page, oldFailure = false, holdNew = false) {
  const response = await page.request.post("/api/projects", {
    data: { brief: { name: "Proposal response ordering" }, useTaste: false },
  });
  expect(response.ok()).toBe(true);
  const p = await response.json(),
    base = `/api/projects/${p.id}/foundation`;
  await page.goto(`/projects/${p.id}/foundation`);
  await expect(page.getByLabel("accent", { exact: true })).toBeEnabled();
  const old = gate(),
    latest = gate();
  let posts = 0,
    newCandidates: Candidate[] = [];
  const applied: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`**${base}/proposals`, async (route) => {
    const index = ++posts,
      reply = await route.fetch();
    expect(reply.ok()).toBe(true);
    if (index === 1) {
      old.enter();
      await old.held;
      if (oldFailure)
        return route.fulfill({
          status: 500,
          json: { message: "ABANDONED_REQUEST_FAILURE" },
        });
    } else {
      newCandidates = (await reply.json()).candidates;
      latest.enter();
      if (holdNew) await latest.held;
    }
    await route.fulfill({ response: reply });
  });
  page.on("request", (request) => {
    if (request.url().endsWith(`${base}/apply`) && request.method() === "POST")
      applied.push(request.postDataJSON().id);
  });
  await page
    .getByRole("button", { name: "角丸をもう少し弱くしたい", exact: true })
    .click();
  await old.entered;
  const finishOld = async () => {
    const returned = page.waitForResponse(
      (response) =>
        response.url().endsWith(`${base}/proposals`) &&
        response.request().postDataJSON().baseRevision === 1,
    );
    old.release();
    await (await returned).finished();
    // Let the delivered response and React's update reach the next paint.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  };
  return {
    p,
    base,
    old,
    latest,
    finishOld,
    posts: () => posts,
    newCandidates: () => newCandidates,
    applied,
    errors,
    read: async () => (await (await page.request.get(base)).json()).current,
  };
}
async function manualSave(
  page: Page,
  f: Awaited<ReturnType<typeof setup>>,
  editor: string,
) {
  if (editor === "components") {
    await page
      .locator("nav")
      .getByRole("link", { name: "Components", exact: true })
      .click();
    await page.getByLabel("size", { exact: true }).selectOption("lg");
  } else if (editor === "patterns") {
    await page
      .locator("nav")
      .getByRole("link", { name: "Patterns", exact: true })
      .click();
    await page.getByLabel("余白 (px)", { exact: true }).fill("32");
  } else await page.getByLabel("accent", { exact: true }).fill("#334455");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect.poll(async () => (await f.read()).revision).toBe(2);
  if (editor === "preview")
    await page
      .locator("nav")
      .getByRole("link", { name: "Preview", exact: true })
      .click();
  await page
    .getByRole("button", { name: "一覧の余白を詰めたい", exact: true })
    .click();
  await f.latest.entered;
}
async function adoptSecond(page: Page, f: Awaited<ReturnType<typeof setup>>) {
  await expect(
    page.getByRole("button", { name: "候補 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("ABANDONED_REQUEST_FAILURE", { exact: true }),
  ).toHaveCount(0);
  await expect(page.frameLocator("iframe").locator(".sample-app")).toHaveCSS(
    "--preview-radius",
    "2px",
  );
  await page.getByRole("button", { name: "採用する", exact: true }).click();
  await expect.poll(async () => (await f.read()).revision).toBe(3);
  expect(f.applied).toEqual([f.newCandidates()[1].id]);
  expect((await f.read()).design.radius).toBe(2);
  expect(f.posts()).toBe(2);
  expect(f.errors).toEqual([]);
}
for (const editor of ["foundation", "components", "patterns", "preview"])
  test(`${editor} late abandoned proposal cannot change a newer selected candidate or adoption ID`, async ({
    page,
  }) => {
    const f = await setup(page);
    try {
      await manualSave(page, f, editor);
      await page.getByRole("button", { name: "候補 2", exact: true }).click();
      await f.finishOld();
      await adoptSecond(page, f);
      const design = (await f.read()).design;
      if (editor === "components")
        expect(design.components.Button.size).toBe("lg");
      else if (editor === "patterns")
        expect(design.patterns.ListPage.gap).toBe(32);
      else expect(design.accent).toBe("#334455");
    } finally {
      f.old.release();
      f.latest.release();
    }
  });
test("an abandoned failure preserves the newer candidate selection and never displays its error", async ({
  page,
}) => {
  const f = await setup(page, true);
  try {
    await manualSave(page, f, "foundation");
    await page.getByRole("button", { name: "候補 2", exact: true }).click();
    await f.finishOld();
    await adoptSecond(page, f);
  } finally {
    f.old.release();
    f.latest.release();
  }
});
test("an abandoned success does not end a newer pending proposal and new candidates start at candidate one", async ({
  page,
}) => {
  const f = await setup(page, false, true);
  try {
    await manualSave(page, f, "foundation");
    await f.finishOld();
    await expect(
      page.getByText("Codex候補を作成中…", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "候補 1", exact: true }),
    ).toHaveCount(0);
    f.latest.release();
    await expect(
      page.getByRole("button", { name: "候補 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "候補 2", exact: true }).click();
    await adoptSecond(page, f);
  } finally {
    f.old.release();
    f.latest.release();
  }
});
test("asking again after selecting candidate two starts the next result at candidate one", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await manualSave(page, f, "foundation");
    await f.finishOld();
    await page.getByRole("button", { name: "候補 2", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "候補 2", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const returned = page.waitForResponse(
      (response) =>
        response.url().endsWith(`${f.base}/proposals`) &&
        response.request().postDataJSON().prompt === "角丸をもう少し弱くしたい",
    );
    await page
      .getByRole("button", { name: "角丸をもう少し弱くしたい", exact: true })
      .click();
    await (await returned).finished();
    await expect(
      page.getByRole("button", { name: "候補 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.frameLocator("iframe").locator(".sample-app")).toHaveCSS(
      "--preview-radius",
      "4px",
    );
    await page.getByRole("button", { name: "採用する", exact: true }).click();
    await expect.poll(async () => (await f.read()).revision).toBe(3);
    expect(f.applied).toEqual([f.newCandidates()[0].id]);
    expect((await f.read()).design.radius).toBe(4);
    expect(f.posts()).toBe(3);
    expect(f.errors).toEqual([]);
  } finally {
    f.old.release();
    f.latest.release();
  }
});
for (const oldFailure of [false, true])
  test(`a reset without a new request keeps its manual draft after late ${oldFailure ? "failure" : "success"}`, async ({
    page,
  }) => {
    const f = await setup(page, oldFailure);
    try {
      await page.getByLabel("accent", { exact: true }).fill("#334455");
      await f.finishOld();
      await expect(
        page.getByRole("button", { name: "候補 1", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("ABANDONED_REQUEST_FAILURE", { exact: true }),
      ).toHaveCount(0);
      await expect(page.getByLabel("accent", { exact: true })).toHaveValue(
        "#334455",
      );
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      await expect.poll(async () => (await f.read()).revision).toBe(2);
      expect((await f.read()).design.accent).toBe("#334455");
      expect(f.posts()).toBe(1);
      expect(f.applied).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      f.old.release();
      f.latest.release();
    }
  });
