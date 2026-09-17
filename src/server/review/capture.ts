import { chromium } from "playwright";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
import type { Design } from "../../domain/design";
import type { Finding } from "../../domain/review";
export type ScreenCapture = {
  image: Buffer;
  findings: Finding[];
  verifiedRules: string[];
  scope: string[];
};
export type CaptureReview = (
  design: Design,
  screen: string,
  signal: AbortSignal,
) => Promise<ScreenCapture>;
export function reviewCapture(
  origin: string,
  width: 390 | 768 | 1440 = 1440,
): CaptureReview {
  // This origin is supplied by the server entrypoint, never by a request.
  return async (design, screen, signal) => {
    signal.throwIfAborted();
    const browser = await chromium.launch({ headless: true });
    const abort = () => {
      void browser.close();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
      });
      // tsx preserves function names with this helper inside serialized callbacks.
      await page.addInitScript("globalThis.__name = (value) => value");
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`${origin}/preview-render`, { timeout: 30000 });
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
      await page.evaluate(() => document.fonts.ready);
      const image = await page.screenshot({ fullPage: true });
      await page.addScriptTag({ content: axe.source });
      const audit = await page.evaluate(async () =>
        (window as unknown as { axe: typeof axe }).axe.run(".sample-app", {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        }),
      );
      const findings: Finding[] = audit.violations.flatMap((v) =>
        v.nodes.map((n) => ({
          id: randomUUID(),
          source: "machine",
          ruleId: v.id,
          targetPath: `${screen}:${n.target.join(" ")}`,
          severity:
            v.impact === "critical" || v.impact === "serious"
              ? "error"
              : "warning",
          evidence: `${n.html}\n${n.failureSummary || v.help}`,
          explanation: v.help,
          suggestedChange: v.helpUrl,
        })),
      );
      const checks = await page.evaluate((design) => {
        const issues: {
          ruleId: string;
          targetPath: string;
          evidence: string;
        }[] = [];
        const root = document.querySelector(".sample-app")!;
        for (const [index, el] of [
          root as HTMLElement,
          ...root.querySelectorAll<HTMLElement>("*"),
        ].entries()) {
          const css = getComputedStyle(el);
          const targetPath = `${el.tagName.toLowerCase()}[${index}]${el.className ? `.${String(el.className).replaceAll(" ", ".")}` : ""}`;
          if (
            (!design.shadow ||
              (el === root &&
                !design.shadowAllowed
                  .split(/[、,\n]/)
                  .map((s) => s.trim())
                  .includes("Preview"))) &&
            css.boxShadow !== "none"
          )
            issues.push({
              ruleId: "shadow",
              targetPath,
              evidence: css.boxShadow,
            });
          if (
            !el.matches(
              ".avatar, .sample-status, .sample-status *, .status-dot, .sample-user, .sample-logo",
            ) &&
            parseFloat(css.borderTopLeftRadius) >
              Math.max(design.radius, design.radiusSm, design.radiusLg)
          )
            issues.push({
              ruleId: "radius",
              targetPath,
              evidence: css.borderTopLeftRadius,
            });
          // Inspect authored declarations: computed styles alone hide unresolved var() values.
          const inspect = (value: string) => {
            for (const match of value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g))
              if (!css.getPropertyValue(match[1]).trim())
                issues.push({
                  ruleId: "tokens",
                  targetPath,
                  evidence: match[0],
                });
          };
          inspect(el.getAttribute("style") || "");
          const states = new Set<string>();
          const rules = (list: CSSRuleList) => {
            for (const rule of list) {
              if (rule instanceof CSSStyleRule) {
                for (const selector of rule.selectorText.split(",")) {
                  try {
                    if (el.matches(selector)) inspect(rule.style.cssText);
                    for (const state of [
                      "hover",
                      "focus-visible",
                      "disabled",
                      "invalid",
                    ])
                      if (
                        selector.includes(`:${state}`) &&
                        el.matches(selector.replaceAll(`:${state}`, ""))
                      )
                        states.add(state);
                  } catch {
                    /* unsupported or pseudo-element selector */
                  }
                }
              } else if ("cssRules" in rule)
                rules((rule as CSSGroupingRule).cssRules);
            }
          };
          for (const sheet of document.styleSheets) {
            try {
              rules(sheet.cssRules);
            } catch {
              /* same-origin sheets only */
            }
          }
          if (el.matches("button, input, select")) {
            const required = [
              "hover",
              "focus-visible",
              "disabled",
              ...(el.hasAttribute("required") ? ["invalid"] : []),
            ];
            const missing = required.filter((state) => !states.has(state));
            if (missing.length)
              issues.push({
                ruleId: "states",
                targetPath,
                evidence: `未定義の状態: ${missing.join(", ")}`,
              });
          }
        }
        return issues;
      }, design);
      for (const issue of checks)
        findings.push({
          ...issue,
          targetPath: `${screen}:${issue.targetPath}`,
          id: randomUUID(),
          source: "machine",
          severity: "error",
          explanation: "確定設定と実画面のスタイルが一致していません。",
          suggestedChange: "対象のCSSとトークン参照を修正してください。",
        });
      const controls = page.locator(
        ".sample-app button, .sample-app input:not([type=hidden]), .sample-app select",
      );
      for (let i = 0; i < (await controls.count()); i++) {
        const control = controls.nth(i);
        const style = () =>
          control.evaluate((el) => {
            const c = getComputedStyle(el);
            return [
              c.outlineStyle,
              c.outlineWidth,
              c.outlineColor,
              c.boxShadow,
              c.borderColor,
              c.backgroundColor,
            ].join(";");
          });
        const before = await style();
        await page.keyboard.press("Tab");
        await control.focus();
        if (before === (await style()))
          findings.push({
            id: randomUUID(),
            source: "machine",
            ruleId: "focus",
            targetPath: `${screen}:control[${i}]`,
            severity: "warning",
            evidence: before,
            explanation:
              "フォーカス前後でoutline・影・境界・背景の変化がありません。",
            suggestedChange:
              ":focus-visibleに視認できるスタイルを定義してください。",
          });
        await control.evaluate((el) => (el as HTMLElement).blur());
      }
      return {
        image,
        findings,
        verifiedRules: [
          ...new Set([...audit.passes, ...audit.violations].map((r) => r.id)),
          "tokens",
          "shadow",
          "radius",
          "focus",
          "states",
        ],
        scope: [
          `${screen}: ${width}×1000、初期表示、入力とボタンのfocus状態`,
          ...audit.incomplete.map((r) => `${screen}: ${r.id} は手動確認が必要`),
        ],
      };
    } finally {
      signal.removeEventListener("abort", abort);
      await browser.close();
    }
  };
}
