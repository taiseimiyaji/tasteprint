import { test, expect } from "@playwright/test";
import type { Conversation } from "../src/domain/projects";

for (const savedDraft of [false, true])
  test(`conversation order survives a late accepted reply and failed GET at ${savedDraft ? "different" : "same"} revisions`, async ({
    page,
  }) => {
    const response = await page.request.post("/api/projects", {
      data: { brief: { name: "Ordered conversation" }, useTaste: false },
    });
    expect(response.ok()).toBe(true);
    const p = await response.json(),
      base = `/api/projects/${p.id}`;
    const firstText = "一覧の余白を広くしたい — first";
    const secondText = "角丸を弱くしたい — second";
    let release!: () => void, enter!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const entered = new Promise<void>((resolve) => (enter = resolve));
    let failReads = false,
      posts = 0,
      failedReads = 0,
      proposals = 0;
    const accepted: Conversation[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().endsWith(`${base}/foundation/proposals`)
      )
        proposals++;
    });
    await page.goto(`/projects/${p.id}/foundation`);
    await expect(page.getByLabel("accent", { exact: true })).toBeEnabled();
    await page.route(`**${base}/conversations`, async (route) => {
      if (route.request().method() === "GET" && failReads) {
        failedReads++;
        return route.fulfill({
          status: 503,
          json: { message: "ISOLATED_HISTORY_GET_FAILURE" },
        });
      }
      if (route.request().method() !== "POST") return route.continue();
      const index = ++posts,
        reply = await route.fetch();
      expect(reply.ok()).toBe(true);
      accepted[index - 1] = await reply.json();
      failReads = true;
      if (index === 1) {
        enter();
        await held;
      }
      await route.fulfill({ response: reply });
    });
    const displayed = async () =>
      (
        await page.locator(".conversation-content > p").allTextContents()
      ).filter((text) => [firstText, secondText].includes(text));
    try {
      await page.locator("#prompt").fill(firstText);
      await page
        .getByRole("button", { name: "提案を依頼", exact: true })
        .click();
      await entered;
      await page.getByLabel("accent", { exact: true }).fill("#334455");
      if (savedDraft) {
        await page
          .getByRole("button", { name: "変更を保存", exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (await (await page.request.get(`${base}/foundation`)).json())
                .current.revision,
          )
          .toBe(2);
      } else {
        await page
          .getByRole("button", { name: "元に戻す", exact: true })
          .click();
        await expect(
          page.getByLabel("accent", { exact: true }),
        ).not.toHaveValue("#334455");
      }
      await page.locator("#prompt").fill(secondText);
      await page
        .getByRole("button", { name: "提案を依頼", exact: true })
        .click();
      await page.getByRole("button", { name: "候補 2", exact: true }).click();
      await expect.poll(displayed).toEqual([secondText]);
      release();
      await expect.poll(displayed).toEqual([firstText, secondText]);
      await expect.poll(() => proposals).toBe(2);
      await expect(
        page.getByRole("button", { name: "候補 2", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const stored: Conversation[] = await (
        await page.request.get(`${base}/conversations`)
      ).json();
      expect(stored).toEqual(accepted);
      expect(stored.map((m) => m.sequence)).toEqual([1, 2]);
      expect(stored.map((m) => m.baseRevision)).toEqual([
        1,
        savedDraft ? 2 : 1,
      ]);
      expect(failedReads).toBeGreaterThanOrEqual(2);
      expect(posts).toBe(2);
      expect(errors).toEqual([]);
      failReads = false;
      await page.reload();
      await expect.poll(displayed).toEqual([firstText, secondText]);
      expect(posts).toBe(2);
      expect(proposals).toBe(2);
      expect(
        (await (await page.request.get(`${base}/foundation`)).json()).current
          .revision,
      ).toBe(savedDraft ? 2 : 1);
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
