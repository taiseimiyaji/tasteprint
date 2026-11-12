import { expect, test, type Page } from "@playwright/test";

async function nav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute("aria-expanded")) === "false"
  )
    await menu.click();
  await page.locator("nav").getByRole("link", { name, exact: true }).click();
}

for (const [width, readFailure, external] of [
  [1440, false, false],
  [1440, true, false],
  [390, false, false],
  [390, true, false],
  [1440, false, true],
] as const)
  test(`Review apply permits next editing while supplementary GET is pending then ${readFailure ? "fails" : "succeeds"} at ${width}${external ? " with a newer revision" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1050 });
    const project = await (
      await page.request.post("/api/projects", {
        data: {
          brief: {
            name: `Review supplementary read ${width} ${readFailure}`,
          },
          useTaste: false,
        },
      })
    ).json();
    const base = `/api/projects/${project.id}`;
    const read = async () =>
      (await (await page.request.get(`${base}/foundation`)).json()).current;
    const draft = () =>
      page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem(`tasteprint.scope.${id}.draft.v1`) || "null",
          ),
        project.id,
      );
    await page.goto(`/projects/${project.id}/review`);
    await page
      .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
      .click();
    await expect(
      page.getByText("要判断の指摘数:", { exact: false }),
    ).toBeVisible({ timeout: 60000 });
    await page
      .getByRole("button", { name: "修正案を作成", exact: true })
      .click();
    await page
      .getByRole("button", { name: /仮Preview:/ })
      .first()
      .click();

    let releasePost!: () => void, postEntered!: () => void;
    let releaseRead!: () => void, readEntered!: () => void;
    const heldPost = new Promise<void>((r) => (releasePost = r));
    const postStarted = new Promise<void>((r) => (postEntered = r));
    const heldRead = new Promise<void>((r) => (releaseRead = r));
    const readStarted = new Promise<void>((r) => (readEntered = r));
    let followup = false,
      holdRead = true,
      failRead = readFailure,
      applyPosts = 0;
    await page.route(`**${base}/reviews`, async (route) => {
      if (route.request().method() !== "GET" || !followup)
        return route.continue();
      if (holdRead) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        readEntered();
        await heldRead;
        if (!failRead) return route.fulfill({ response });
      }
      if (failRead)
        return route.fulfill({
          status: 503,
          json: { message: "SUPPLEMENTARY_REVIEW_READ_FAILED" },
        });
      return route.continue();
    });
    await page.route(`**${base}/foundation/apply`, async (route) => {
      expect(route.request().method()).toBe("POST");
      applyPosts++;
      postEntered();
      await heldPost;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      followup = true;
      await route.fulfill({ response });
    });
    try {
      const reply = page.waitForResponse(
        (r) =>
          r.url().endsWith(`${base}/foundation/apply`) &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "まとめて適用", exact: true })
        .click();
      await postStarted;
      expect((await read()).revision).toBe(1);
      await nav(page, "Foundation");
      await page.getByRole("tab", { name: "Radius", exact: true }).click();
      const radius = page.getByRole("spinbutton", {
        name: "radius",
        exact: true,
      });
      await expect(radius).toBeDisabled();
      await expect(page.locator(".save-status")).toContainText("設計 r1");
      expect((await draft()).baseRevision).toBe(1);

      releasePost();
      const receipt = await (await reply).json();
      await readStarted;
      await expect(page.locator(".save-status")).toContainText("設計 r2");
      await expect.poll(async () => (await draft()).baseRevision).toBe(2);
      expect((await draft()).design).toEqual(receipt.design);
      await expect(radius).toHaveValue(String(receipt.design.radius));
      await expect(radius).toBeEnabled();
      await nav(page, "AI Review");
      await expect(
        page.getByRole("button", { name: "まとめて適用", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "処理中…", exact: true }),
      ).toBeDisabled();
      await nav(page, "Foundation");
      await radius.fill("7");
      await expect.poll(async () => (await draft()).design.radius).toBe(7);

      if (external) {
        const changed = await page.request.post(`${base}/foundation/save`, {
          data: {
            baseRevision: 2,
            design: { ...receipt.design, accent: "#445566" },
            reason: "Synthetic external revision while Review GET is pending",
            requestId: crypto.randomUUID(),
          },
        });
        expect(changed.ok()).toBe(true);
        expect((await changed.json()).revision).toBe(3);
        await page.evaluate(() =>
          window.dispatchEvent(new Event("visibilitychange")),
        );
        await expect(page.locator(".save-status")).toContainText("設計 r3");
        await expect(page.locator(".editor-actions")).toContainText(
          "下書きの版が古くなっています",
        );
        await expect(
          page.getByRole("button", { name: "変更を保存", exact: true }),
        ).toBeDisabled();
      }

      holdRead = false;
      releaseRead();
      await nav(page, "AI Review");
      await expect(
        page.getByRole("button", {
          name: "3画面を撮影してレビュー",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        page.getByText("古い結果 · 再レビューしてください", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "まとめて適用", exact: true }),
      ).toHaveCount(0);
      if (readFailure) {
        await expect(page.getByRole("alert")).toContainText(
          "SUPPLEMENTARY_REVIEW_READ_FAILED",
        );
        failRead = false;
        await page
          .getByRole("button", { name: "結果を再取得", exact: true })
          .click();
        await expect(
          page.getByText("SUPPLEMENTARY_REVIEW_READ_FAILED", {
            exact: false,
          }),
        ).toHaveCount(0);
      }
      await nav(page, "Foundation");
      await expect(radius).toBeEnabled();
      await expect(radius).toHaveValue("7");
      expect((await draft()).baseRevision).toBe(2);
      expect((await draft()).design).toEqual({
        ...receipt.design,
        radius: 7,
      });
      const current = await read();
      expect(current.revision).toBe(external ? 3 : 2);
      expect(current.design).toEqual(
        external ? { ...receipt.design, accent: "#445566" } : receipt.design,
      );
      if (external) {
        await expect(page.locator(".save-status")).toContainText("設計 r3");
        const stale = await page.request.post(`${base}/foundation/save`, {
          data: {
            baseRevision: 2,
            design: (await draft()).design,
            reason: "Reject the old draft without replacing the newer revision",
            requestId: crypto.randomUUID(),
          },
        });
        expect(stale.status()).toBe(409);
        expect((await read()).design).toEqual(current.design);
      }
      expect(applyPosts).toBe(1);
      expect(
        (await (await page.request.get("/api/health")).json()).codexCalls,
      ).toBe(0);
    } finally {
      releasePost();
      holdRead = false;
      releaseRead();
    }
  });
