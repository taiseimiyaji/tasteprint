import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const created: { base: string; id: string }[] = [];
test.afterEach(async ({ request }) => {
  for (const { base, id } of created.splice(0)) {
    const row = (await (await request.get(base)).json()).references.find(
      (r: any) => r.id === id,
    );
    if (row)
      expect(
        (
          await request.delete(`${base}/${id}`, {
            data: { version: row.version },
          })
        ).ok(),
      ).toBe(true);
  }
});
for (const profile of [true, false])
  for (const width of [1440, 390]) {
    test(`Reference middle note save keeps card position ${profile ? "Profile" : "Project"} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      let base = "/api/profile/references",
        path = "/profile";
      if (!profile) {
        const response = await page.request.post("/api/projects", {
          data: { brief: { name: `Order probe ${width}` }, useTaste: false },
        });
        expect(response.ok()).toBe(true);
        const p = await response.json();
        base = `/api/projects/${p.id}/references`;
        path = `/projects/${p.id}/inspiration`;
      }
      const prefix = `Order ${randomUUID().slice(0, 8)}`;
      const names = ["first", "middle", "last"].map((n) => `${prefix} ${n}`);
      for (const name of names) {
        const response = await page.request.post(base, {
          data: {
            name,
            url: "",
            selections: [{ aspect: "Colors", intent: "reference" }],
            likes: "",
            dislikes: "",
          },
        });
        expect(response.ok()).toBe(true);
        const ref = await response.json();
        created.push({ base, id: ref.id });
      }
      await page.goto(path);
      if (profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      const headings = page
        .locator(".reference-card h3")
        .filter({ hasText: prefix });
      await expect(headings).toHaveText(names);
      const card = page.locator(".reference-card").filter({
        has: page.getByRole("heading", {
          name: names[1],
          exact: true,
          level: 3,
        }),
      });
      await card
        .getByRole("textbox", { name: "好きな点", exact: true })
        .fill("order probe saved note");
      await card
        .getByRole("button", { name: "観点・メモを保存", exact: true })
        .click();
      await expect(headings).toHaveText(names, { timeout: 10000 });
      await expect(
        card.getByRole("button", { name: "観点・メモを保存", exact: true }),
      ).toBeDisabled();
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toBeEditable();
      await page.reload();
      if (profile)
        await page
          .getByRole("button", { name: "参考を集める", exact: true })
          .click();
      await expect(headings).toHaveText(names);
      await expect(
        card.getByRole("textbox", { name: "好きな点", exact: true }),
      ).toHaveValue("order probe saved note");
      const rows = (
        await (await page.request.get(base)).json()
      ).references.filter((r: any) => r.name.startsWith(prefix));
      expect(rows.map((r: any) => r.name)).toEqual(names);
      expect(rows.find((r: any) => r.name === names[1]).likes).toBe(
        "order probe saved note",
      );
      const evidence = "../evidence/reference-order-after";
      mkdirSync(evidence, { recursive: true });
      const label = `${profile ? "profile" : "project"}-${width}`;
      await page.screenshot({
        path: `${evidence}/${label}.png`,
        fullPage: true,
      });
      writeFileSync(
        `${evidence}/${label}.json`,
        JSON.stringify(
          {
            before: names,
            after: await headings.allTextContents(),
            versions: rows.map((r: any) => ({
              id: r.id,
              version: r.version,
              likes: r.likes,
            })),
          },
          null,
          2,
        ) + "\n",
      );
    });
  }
