import { test, expect } from "@playwright/test";
import axe from "axe-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { defaultDesign } from "../src/domain/design";
const affected = [
  ".sample-breadcrumb",
  'div[data-slot="title"] > p',
  "th:nth-child(1)",
  "th:nth-child(2)",
  "th:nth-child(3)",
  "th:nth-child(4)",
];
for (const width of [1440, 390]) {
  test(`new Project muted text passes the existing contrast check at ${width}, legacy values remain reportable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const created = await page.request.post("/api/projects", {
      data: { brief: { name: "Contrast candidate" }, useTaste: false },
    });
    expect(created.ok()).toBe(true);
    const project = await created.json();
    const accepted = (
      await (
        await page.request.get(`/api/projects/${project.id}/foundation`)
      ).json()
    ).current;
    expect(accepted.revision).toBe(1);
    expect(accepted.design).toEqual({ ...defaultDesign, muted: "#6c7164" });
    const results = [];
    const dir = "../evidence/new-project-color-ui";
    mkdirSync(dir, { recursive: true });
    for (const screen of ["list", "settings", "form"]) {
      for (const version of ["before", "candidate"]) {
        const design = version === "before" ? defaultDesign : accepted.design;
        await page.goto("/preview-render");
        await page.waitForSelector('html[data-renderer-ready="true"]', {
          state: "attached",
        });
        await page.evaluate(
          ({ design, screen }) =>
            window.postMessage(
              { type: "tasteprint-preview", design, screen },
              location.origin,
            ),
          { design, screen },
        );
        await page.waitForSelector(".sample-app");
        await expect
          .poll(() =>
            page
              .locator(".sample-breadcrumb")
              .evaluate((el) => getComputedStyle(el).color),
          )
          .toBe(
            version === "before" ? "rgb(135, 139, 128)" : "rgb(108, 113, 100)",
          );
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${dir}/${screen}-${width}-${version}.png`,
          fullPage: true,
        });
        await page.addScriptTag({ content: axe.source });
        const violations = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(".sample-app", {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        const contrast = violations.violations
          .filter((v) => v.id === "color-contrast")
          .flatMap((v) => v.nodes);
        const relevant = contrast.filter((n) =>
          n.target.some((selector) => affected.includes(String(selector))),
        );
        const incomplete = violations.incomplete
          .filter((v) => v.id === "color-contrast")
          .flatMap((v) => v.nodes)
          .filter((n) =>
            n.target.some((selector) => affected.includes(String(selector))),
          );
        const styles = await page
          .locator(
            '.sample-breadcrumb, div[data-slot="title"] > p, .sample-app th',
          )
          .evaluateAll((nodes) =>
            nodes.map((el) => {
              const s = getComputedStyle(el);
              return {
                text: el.textContent,
                color: s.color,
                background: s.backgroundColor,
                fontSize: s.fontSize,
                fontWeight: s.fontWeight,
              };
            }),
          );
        results.push({
          screen,
          version,
          relevant,
          incomplete,
          otherContrast: contrast.filter((n) => !relevant.includes(n)),
          styles,
        });
        if (version === "before") {
          if (width === 1440)
            expect(relevant.length).toBe(screen === "list" ? 6 : 2);
          else expect(relevant.length).toBeGreaterThanOrEqual(2);
        } else {
          expect(relevant).toEqual([]);
          expect(incomplete).toEqual([]);
        }
      }
    }
    writeFileSync(
      `${dir}/verified-${width}.json`,
      JSON.stringify(results, null, 2),
    );
    if (width === 1440) {
      const response = await page.request.post(
        `/api/projects/${project.id}/reviews`,
        { data: { baseRevision: 1 } },
      );
      expect(response.ok()).toBe(true);
      const review = await response.json();
      expect(review.status).toBe("complete");
      expect(review.images).toHaveLength(3);
      expect(review.verifiedRules).toContain("color-contrast");
      expect(review.baseRevision).toBe(1);
      expect(review.design).toEqual(accepted.design);
      expect(
        review.findings.filter(
          (f: { ruleId: string; targetPath: string }) =>
            f.ruleId === "color-contrast" &&
            affected.includes(
              f.targetPath.slice(f.targetPath.indexOf(":") + 1),
            ),
        ),
      ).toEqual([]);
    }
    const health = await (await page.request.get("/api/health")).json();
    expect(health.codexCalls).toBe(0);
  });
}
