import { test, expect, type Page } from "@playwright/test";

const createdPrinciples: string[] = [];
test.afterEach(async ({ request }) => {
  for (const id of createdPrinciples.splice(0)) {
    const current = (await (await request.get("/api/profile")).json()).current;
    expect(
      (
        await request.post("/api/profile", {
          data: {
            ...current.snapshot,
            baseProfileRevision: current.revision,
            principles: current.snapshot.principles.filter(
              (principle: { id: string }) => principle.id !== id,
            ),
          },
        })
      ).ok(),
    ).toBe(true);
  }
});

function gate() {
  let release!: () => void, enter!: () => void;
  return {
    held: new Promise<void>((resolve) => (release = resolve)),
    entered: new Promise<void>((resolve) => (enter = resolve)),
    release: () => release(),
    enter: () => enter(),
  };
}
async function setup(page: Page) {
  const current = (await (await page.request.get("/api/profile")).json())
    .current;
  const principle = {
    id: `pending-${crypto.randomUUID()}`,
    target: "density",
    text: "行を優先",
    reason: "比較するため",
    sources: ["明示的な入力"],
    locked: false,
  };
  const firstResponse = await page.request.post("/api/profile", {
    data: {
      ...current.snapshot,
      baseProfileRevision: current.revision,
      confirmed: true,
      answers: { "density-0": "a" },
      principles: [...current.snapshot.principles, principle],
    },
  });
  expect(firstResponse.ok()).toBe(true);
  createdPrinciples.push(principle.id);
  const first = await firstResponse.json();
  const created = await page.request.post("/api/projects", {
    data: {
      brief: { name: "Protected taste-diff choice" },
      useTaste: true,
      sourceTasteProfileRevision: first.revision,
    },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const updated = await page.request.post("/api/profile", {
    data: {
      ...first.snapshot,
      baseProfileRevision: first.revision,
      answers: { "density-0": "b" },
      principles: first.snapshot.principles.map((p: typeof principle) =>
        p.id === principle.id ? { ...p, text: "カードを優先" } : p,
      ),
    },
  });
  expect(updated.ok()).toBe(true);
  await page.goto(`/projects/${project.id}/overview`);
  const refresh = page.getByRole("button", { name: "差分を確認", exact: true });
  await refresh.click();
  const answer = page.getByLabel("差分 answer:density-0", { exact: true });
  const policy = page.getByLabel(`差分 principle:${principle.id}`, {
    exact: true,
  });
  await answer.selectOption("adopt");
  await policy.selectOption("adopt");
  await expect(page.locator(".taste-diff select")).toHaveCount(2);
  return {
    base: `/api/projects/${project.id}`,
    answer,
    policy,
    principle,
    refresh,
    confirm: page.getByRole("button", {
      name: "選択を確定して新revisionを作成",
      exact: true,
    }),
  };
}

for (const width of [1440, 390]) {
  test(`Overview protects all submitted choices until the accepted reply at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const f = await setup(page),
      wait = gate();
    const bodies: { choices: Record<string, string> }[] = [];
    await page.route(`**${f.base}/taste-diff`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      wait.enter();
      await wait.held;
      await route.fulfill({ response });
    });
    try {
      await f.confirm.click();
      await wait.entered;
      for (const select of [f.answer, f.policy]) {
        await expect(select).toBeDisabled();
        await expect(select).toHaveValue("adopt");
      }
      await expect(f.refresh).toBeDisabled();
      await expect(f.confirm).toBeDisabled();
      await page.keyboard.press("ArrowDown");
      await expect(f.answer).toHaveValue("adopt");
      expect(bodies).toHaveLength(1);
      expect(bodies[0].choices).toEqual({
        "answer:density-0": "adopt",
        [`principle:${f.principle.id}`]: "adopt",
      });
      await f.answer.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `../evidence/taste-diff-ui/pending-${width}.png`,
      });
      wait.release();
      await expect(f.answer).toHaveCount(0);
      await expect(page.locator(".editor-actions")).toContainText("設計 r2");
      const saved = (await (await page.request.get(f.base)).json()).current;
      expect(saved.revision).toBe(2);
      expect(saved.snapshot.taste.answers["density-0"]).toBe("b");
      expect(
        saved.snapshot.taste.principles.find(
          (p: { id: string }) => p.id === f.principle.id,
        ).text,
      ).toBe("カードを優先");
      await f.refresh.click();
      await expect(
        page.getByText("変更はありません。", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(page.locator(".editor-actions")).toContainText("設計 r2");
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    } finally {
      wait.release();
    }
  });
}
test("Overview failed adoption retains every choice and permits an edited explicit retry", async ({
  page,
}) => {
  const f = await setup(page),
    waits = [gate(), gate()];
  const bodies: { choices: Record<string, string> }[] = [];
  await page.route(`**${f.base}/taste-diff`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const index = bodies.length;
    bodies.push(route.request().postDataJSON());
    if (index === 0) {
      waits[0].enter();
      await waits[0].held;
      return route.fulfill({
        status: 503,
        json: { message: "TASTE_ADOPT_FAILURE" },
      });
    }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    waits[1].enter();
    await waits[1].held;
    await route.fulfill({ response });
  });
  try {
    await f.confirm.click();
    await waits[0].entered;
    await expect(f.answer).toBeDisabled();
    await expect(f.policy).toBeDisabled();
    waits[0].release();
    await expect(
      page.getByRole("alert").filter({ hasText: "TASTE_ADOPT_FAILURE" }),
    ).toBeVisible();
    for (const select of [f.answer, f.policy]) {
      await expect(select).toBeEnabled();
      await expect(select).toHaveValue("adopt");
      await select.selectOption("keep");
    }
    expect(
      (await (await page.request.get(f.base)).json()).current.revision,
    ).toBe(1);
    await f.confirm.click();
    await waits[1].entered;
    await expect(f.answer).toBeDisabled();
    await expect(f.policy).toBeDisabled();
    expect(bodies.map((body) => Object.values(body.choices))).toEqual([
      ["adopt", "adopt"],
      ["keep", "keep"],
    ]);
    waits[1].release();
    await expect(f.answer).toHaveCount(0);
    const saved = (await (await page.request.get(f.base)).json()).current;
    expect(saved.revision).toBe(2);
    expect(saved.snapshot.taste.answers["density-0"]).toBe("a");
    expect(
      saved.snapshot.taste.principles.find(
        (p: { id: string }) => p.id === f.principle.id,
      ).text,
    ).toBe("行を優先");
    expect(
      saved.snapshot.maintained.map((m: { key: string }) => m.key),
    ).toEqual(
      expect.arrayContaining([
        "answer:density-0",
        `principle:${f.principle.id}`,
      ]),
    );
  } finally {
    waits.forEach((wait) => wait.release());
  }
});
for (const fails of [false, true]) {
  test(`Overview explicit diff read protects existing choices and ${fails ? "retains them on failure" : "resets them only after success"}`, async ({
    page,
  }) => {
    const f = await setup(page),
      wait = gate();
    let posts = 0;
    await page.route(`**${f.base}/taste-diff`, async (route) => {
      if (route.request().method() !== "GET") {
        posts++;
        return route.continue();
      }
      wait.enter();
      await wait.held;
      if (fails)
        return route.fulfill({
          status: 503,
          json: { message: "TASTE_DIFF_GET_FAILURE" },
        });
      await route.continue();
    });
    try {
      await f.refresh.click();
      await wait.entered;
      for (const select of [f.answer, f.policy]) {
        await expect(select).toBeDisabled();
        await expect(select).toHaveValue("adopt");
      }
      await expect(f.confirm).toBeDisabled();
      wait.release();
      if (fails)
        await expect(
          page.getByRole("alert").filter({ hasText: "TASTE_DIFF_GET_FAILURE" }),
        ).toBeVisible();
      for (const select of [f.answer, f.policy]) {
        await expect(select).toBeEnabled();
        await expect(select).toHaveValue(fails ? "adopt" : "");
        await select.selectOption("keep");
      }
      await expect(f.confirm).toBeEnabled();
      expect(posts).toBe(0);
      expect(
        (await (await page.request.get(f.base)).json()).current.revision,
      ).toBe(1);
    } finally {
      wait.release();
    }
  });
}
