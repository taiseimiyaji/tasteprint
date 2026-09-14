import { test, expect } from "@playwright/test";
import { reviewCapture } from "../src/server/review/capture";
import { defaultDesign } from "../src/domain/design";
test("shared renderer captures actual contrast and missing-state violations", async () => {
  test.setTimeout(90000);
  const capture = reviewCapture("http://127.0.0.1:3100");
  for (const screen of ["list", "settings", "form"]) {
    const result = await capture(
      { ...defaultDesign, ink: "#ffffff", muted: "#ffffff" },
      screen,
      AbortSignal.timeout(25000),
    );
    expect(result.image.length).toBeGreaterThan(1000);
    expect(result.findings.some((f) => f.ruleId === "color-contrast")).toBe(
      true,
    );
    expect(result.findings.some((f) => f.ruleId === "states")).toBe(true);
    expect(result.verifiedRules).toContain("label");
    expect(result.scope[0]).toContain(screen);
  }
});

test("known DOM violations detect missing labels, unresolved tokens, forbidden shadows and excessive radius", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<!doctype html><html lang="en" data-renderer-ready="true"><head><title>Violations</title><style>.sample-app { background:white; color:black; box-shadow:0 2px 5px black } input,button { outline:none !important; box-shadow:none !important; } input { border-radius:90px; color:var(--missing-token) }</style></head><body><script>addEventListener('message', () => { document.body.innerHTML = '<main class="sample-app"><input required><button>Save</button></main>'; });</script></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const result = await reviewCapture(`http://127.0.0.1:${address.port}`)(
      defaultDesign,
      "form",
      AbortSignal.timeout(20000),
    );
    for (const rule of [
      "label",
      "tokens",
      "shadow",
      "radius",
      "states",
      "focus",
    ])
      expect(
        result.findings.some((f) => f.ruleId === rule),
        rule,
      ).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
