import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { reviewCapture } from "../src/server/review/capture";
import { defaultDesign } from "../src/domain/design";

test("initial shared-renderer focus audit excludes closed dialogs on all three screens", async () => {
  test.setTimeout(90000);
  const evidence = [];
  for (const screen of ["list", "settings", "form"]) {
    const result = await reviewCapture("http://127.0.0.1:3100")(
      defaultDesign,
      screen,
      AbortSignal.timeout(25000),
    );
    expect(result.findings.filter((f) => f.ruleId === "focus")).toEqual([]);
    expect(result.verifiedRules).toContain("focus");
    expect(result.findings.some((f) => f.ruleId === "color-contrast")).toBe(
      true,
    );
    expect(result.findings.some((f) => f.ruleId === "states")).toBe(true);
    expect(result.scope[0]).toContain("表示中・有効・フォーカス可能");
    mkdirSync("../evidence/review-focus-ui", { recursive: true });
    writeFileSync(`../evidence/review-focus-ui/${screen}.png`, result.image);
    evidence.push({ screen, focus: 0, otherFindings: result.findings.length });
  }
  writeFileSync(
    "../evidence/review-focus-ui/verification.json",
    JSON.stringify(evidence, null, 2),
  );
});

test("focus audit keeps real missing indicators and original indexes while skipping unfocusable controls", async () => {
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html lang="en" data-renderer-ready="true"><head><title>Focus controls</title><style>
      button,input {outline:none!important;box-shadow:none!important;border:1px solid black;background:white;color:black}
      .good:focus-visible {outline:3px solid blue!important}
    </style></head><body><main class="sample-app">
      <button>Real missing indicator</button>
      <button class="good">Good indicator</button>
      <button disabled>Disabled</button>
      <fieldset disabled><button>Disabled by fieldset</button></fieldset>
      <button style="display:none">Display none</button>
      <button style="visibility:hidden">Visibility hidden</button>
      <div inert><button>Inert</button></div>
      <button class="good">Good immediately after inert</button>
      <dialog><input aria-label="Closed dialog input"><button>Closed dialog button</button></dialog>
      <button tabindex="-1">Focusable programmatically with missing indicator</button>
    </main></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as { port: number };
    const result = await reviewCapture(`http://127.0.0.1:${port}`)(
      defaultDesign,
      "form",
      AbortSignal.timeout(20000),
    );
    expect(
      result.findings
        .filter((f) => f.ruleId === "focus")
        .map((f) => f.targetPath),
    ).toEqual(["form:control[0]", "form:control[10]"]);
    expect(result.verifiedRules).toContain("focus");
    expect(result.findings.some((f) => f.ruleId === "states")).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("actual Mock Review stores and displays initial results without hidden-dialog focus warnings", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const created = await page.request.post("/api/projects", {
    data: { brief: { name: "Visible focus Review" }, useTaste: false },
  });
  expect(created.ok()).toBe(true);
  const project = await created.json();
  const base = `/api/projects/${project.id}`;
  const initial = (await (await page.request.get(`${base}/foundation`)).json())
    .current;
  await page.goto(`/projects/${project.id}/review`);
  await page
    .getByRole("button", { name: "3画面を撮影してレビュー", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "revision 1 · 確定revisionの結果",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "3画面を撮影してレビュー", exact: true }),
  ).toBeEnabled();
  const review = (await (await page.request.get(`${base}/reviews`)).json())[0];
  expect(review.status).toBe("complete");
  expect(review.design).toEqual(initial.design);
  expect(review.images).toHaveLength(3);
  expect(
    review.findings.filter((f: { ruleId: string }) => f.ruleId === "focus"),
  ).toEqual([]);
  expect(review.verifiedRules).toContain("focus");
  await expect(
    page.getByRole("link", { name: "focus", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "revision 1 · 確定revisionの結果",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "focus", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(
    (await (await page.request.get(`${base}/foundation`)).json()).current,
  ).toEqual(initial);
});
