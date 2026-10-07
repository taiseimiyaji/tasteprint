import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import sharp from "sharp";

test.use({ actionTimeout: 10000 });
const evidence = "../evidence/export-edited-consumer";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const first = {
  Colors: {
    accent: "#206493",
    canvas: "#e6edf3",
    surface: "#fffdf7",
    ink: "#182c3c",
    muted: "#52657a",
  },
  Typography: {
    fontFamily: "serif",
    fontSize: 16,
    heading1: 34,
    heading2: 26,
    heading3: 20,
    lineHeight: 1.8,
    bodyWeight: 500,
    headingWeight: 700,
  },
  Spacing: {
    spacing: 20,
    controlHeight: 52,
    rowHeight: 64,
    pagePadding: 28,
    sectionGap: 32,
  },
  Radius: { radius: 10 },
};
const second = {
  Colors: {
    accent: "#845034",
    canvas: "#f6ece5",
    surface: "#fffaf5",
    ink: "#402419",
    muted: "#765748",
  },
  Typography: {
    fontFamily: "monospace",
    fontSize: 18,
    heading1: 38,
    heading2: 28,
    heading3: 22,
    lineHeight: 1.4,
    bodyWeight: 400,
    headingWeight: 600,
  },
  Spacing: {
    spacing: 12,
    controlHeight: 40,
    rowHeight: 56,
    pagePadding: 20,
    sectionGap: 24,
  },
  Radius: { radius: 2 },
};
async function edit(
  page: Page,
  id: string,
  fields: typeof first | typeof second,
) {
  await page.goto(`/projects/${id}/foundation`);
  for (const [tab, values] of Object.entries(fields)) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    for (const [key, value] of Object.entries(values)) {
      const input = page.getByLabel(key, { exact: true });
      if (key === "fontFamily") await input.selectOption(String(value));
      else await input.fill(String(value));
    }
  }
}
async function save(page: Page, revision: number) {
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(
    page.getByText(new RegExp(`確定履歴（revision ${revision}`)),
  ).toBeVisible();
}
async function download(page: Page, id: string, revision: number) {
  const response = await page.request.post(`/api/projects/${id}/exports`, {
    data: { baseRevision: revision, bundle: true, imageMode: "include" },
    timeout: 60000,
  });
  expect(response.ok()).toBe(true);
  const record = await response.json();
  const zipName = Object.keys(record.files).find((name) =>
    name.endsWith(".zip"),
  )!;
  const url = `/api/projects/${id}/exports/${record.id}/${zipName}`;
  const zip = await page.request.get(url);
  expect(zip.ok()).toBe(true);
  const bytes = await zip.body(),
    entries = unzipSync(bytes);
  const directory = `test-results/edited-export-${id}-r${revision}`;
  for (const [path, content] of Object.entries(entries)) {
    const destination = join(directory, path.split("/").slice(1).join("/"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  writeFileSync(join(evidence, `${id}-r${revision}.zip`), bytes);
  const json = JSON.parse(
    readFileSync(join(directory, "design-system.json"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  );
  expect(record.templateVersion).toBe("preview-11");
  expect(json.revision).toBe(revision);
  expect(manifest.revision).toBe(revision);
  expect(manifest.templateVersion).toBe("preview-11");
  return { record, url, bytes, directory, json, manifest };
}
async function metrics(root: Locator) {
  return root.evaluate((el) => {
    const style = getComputedStyle(el);
    const values = (selector: string) => {
      const item = el.querySelector(selector)! as HTMLElement,
        css = getComputedStyle(item);
      return {
        fontFamily: css.fontFamily,
        fontSize: css.fontSize,
        fontWeight: css.fontWeight,
        color: css.color,
        background: css.backgroundColor,
        minHeight: css.minHeight,
        height: item.getBoundingClientRect().height,
      };
    };
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      color: style.color,
      background: style.backgroundColor,
      heading: values(".sample-heading h3"),
      input: values('input[data-component="Input"]'),
      button: values('button[data-component="Button"]'),
      select: values('select[data-component="Select"]'),
    };
  });
}
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
async function verifyAppearance(
  page: Page,
  id: string,
  archive: Awaited<ReturnType<typeof download>>,
  width: number,
  edition: string,
  violations: unknown[],
) {
  const d = archive.json.design;
  writeFileSync(
    join(archive.directory, "pages.tsx"),
    `import{createRoot}from'react-dom/client';import{ListPage,SettingsPage,FormPage}from'./ui';const screen=new URL(import.meta.url).searchParams.get('screen');const Screen=screen==='settings'?SettingsPage:screen==='form'?FormPage:ListPage;createRoot(document.getElementById('consumer-root')!).render(<Screen/>);`,
  );
  const results = [];
  for (const screen of ["list", "settings", "form"]) {
    // Verify the saved project UI passes the edited design to its real Preview.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/projects/${id}/preview`);
    await page
      .getByRole("button", {
        name: width === 390 ? "Mobile 390px" : "Desktop 1440px",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: screen[0].toUpperCase() + screen.slice(1),
        exact: true,
      })
      .click();
    const frameRoot = page.frameLocator("iframe").locator(".sample-app");
    await expect(frameRoot).toHaveCSS("font-family", d.fontFamily);
    await expect(frameRoot).toHaveCSS("--color-accent", d.accent);
    await expect(frameRoot.locator(".sample-breadcrumb")).toHaveText(
      `Workspace / ${screen}`,
    );
    await expect(frameRoot).toHaveAttribute(
      "data-layout",
      width === 390 ? "compact" : "wide",
    );
    await frameRoot.evaluate((el) => el.ownerDocument.fonts.ready);
    const projectMetrics = await metrics(frameRoot);

    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/preview-render");
    await expect(page.locator("html")).toHaveAttribute(
      "data-renderer-ready",
      "true",
    );
    await page.evaluate(
      ({ design, screen }) =>
        window.postMessage(
          { type: "tasteprint-preview", design, screen },
          location.origin,
        ),
      { design: d, screen },
    );
    const root = page.locator(".sample-app");
    await expect(root).toHaveCSS("--color-accent", d.accent);
    await page.evaluate(() => document.fonts.ready);
    await expect(root).toHaveAttribute(
      "data-layout",
      width === 390 ? "compact" : "wide",
    );
    const normalMetrics = await metrics(root);
    expect(normalMetrics).toEqual(projectMetrics);
    expect(normalMetrics.fontFamily).toBe(d.fontFamily);
    expect(normalMetrics.fontSize).toBe(`${d.fontSize}px`);
    expect(normalMetrics.fontWeight).toBe(String(d.bodyWeight));
    expect(normalMetrics.background).toBe(rgb(d.surface));
    expect(normalMetrics.color).toBe(rgb(d.ink));
    expect(normalMetrics.heading.fontSize).toBe(`${d.heading1}px`);
    expect(normalMetrics.heading.fontWeight).toBe(String(d.headingWeight));
    expect(parseFloat(normalMetrics.lineHeight)).toBeCloseTo(
      d.fontSize * d.lineHeight,
      2,
    );
    if (screen === "form")
      await expect(root.locator('[data-pattern="FormSection"]')).toHaveCSS(
        "gap",
        "32px",
      );
    expect(normalMetrics.input.minHeight).toBe(`${d.controlHeight + 8}px`);
    expect(normalMetrics.input.height).toBe(d.controlHeight + 8);
    if (normalMetrics.input.fontSize !== `${d.fontSize + 2}px`)
      violations.push({
        width,
        screen,
        edition,
        target: "Input.fontSize",
        expected: `${d.fontSize + 2}px`,
        actual: normalMetrics.input.fontSize,
      });
    expect(normalMetrics.button.minHeight).toBe(`${d.controlHeight - 8}px`);
    expect(normalMetrics.button.fontSize).toBe(`${d.fontSize - 2}px`);
    expect(normalMetrics.select.minHeight).toBe(`${d.controlHeight}px`);
    const backdrop = await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.move(0, 0);
    const normal = await root.screenshot();
    writeFileSync(
      join(evidence, `${edition}-${screen}-normal-${width}.png`),
      normal,
    );
    if (width === 1440) {
      const full = await page.screenshot({ fullPage: true });
      writeFileSync(
        join(evidence, `${edition}-${screen}-full-${width}.png`),
        full,
      );
      const png = readFileSync(
        join(archive.directory, "examples", `${screen}.png`),
      );
      const actual = await sharp(full)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const saved = await sharp(png)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(actual.info.width).toBe(saved.info.width);
      expect(actual.info.height).toBe(saved.info.height);
      let changed = 0;
      for (let i = 0; i < actual.data.length; i += 3)
        if (
          actual.data[i] !== saved.data[i] ||
          actual.data[i + 1] !== saved.data[i + 1] ||
          actual.data[i + 2] !== saved.data[i + 2]
        )
          changed++;
      // Separate browser captures can differ at a few rounded-corner pixels.
      expect(
        changed / (actual.info.width * actual.info.height),
      ).toBeLessThanOrEqual(0.0001);
      writeFileSync(
        join(evidence, `${edition}-${screen}-zip-png-${width}.json`),
        JSON.stringify(
          {
            width: actual.info.width,
            height: actual.info.height,
            changedPixels: changed,
            pixelCount: actual.info.width * actual.info.height,
          },
          null,
          2,
        ),
      );
    }
    writeFileSync(
      join(archive.directory, `pages-${screen}.html`),
      `<!doctype html><html lang="ja"><head><style>body{margin:0;background:${backdrop}}</style></head><body><div id="consumer-root"></div><script type="module" src="/${archive.directory}/pages.tsx?screen=${screen}"></script></body></html>`,
    );
    await page.goto(`/${archive.directory}/pages-${screen}.html`);
    const portable = page.locator(".sample-app");
    await expect(portable).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(portable).toHaveAttribute(
      "data-layout",
      width === 390 ? "compact" : "wide",
    );
    await page.mouse.move(0, 0);
    const exported = await portable.screenshot();
    writeFileSync(
      join(evidence, `${edition}-${screen}-portable-${width}.png`),
      exported,
    );
    if (!exported.equals(normal)) {
      // Keep the actual compared bytes in CI artifacts before the strict assertion.
      await test.info().attach(`${edition}-${screen}-normal-${width}`, {
        body: normal,
        contentType: "image/png",
      });
      await test.info().attach(`${edition}-${screen}-portable-${width}`, {
        body: exported,
        contentType: "image/png",
      });
      await test.info().attach(`${edition}-${screen}-metrics-${width}`, {
        body: JSON.stringify(
          { normal: normalMetrics, portable: await metrics(portable) },
          null,
          2,
        ),
        contentType: "application/json",
      });
    }
    expect(exported.equals(normal)).toBe(true);
    expect(await metrics(portable)).toEqual(normalMetrics);
    results.push({
      screen,
      width,
      pngEqual: true,
      normalSha256: sha(normal),
      metrics: normalMetrics,
    });
    if (screen === "list") {
      const all = page.getByRole("tab", { name: "All projects" });
      await all.focus();
      await all.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Archived" })).toBeFocused();
      await expect(
        page.getByText("No projects found. Try another search."),
      ).toBeVisible();
      await page.keyboard.press("ArrowLeft");
      const opener = page.getByRole("button", {
        name: "New project",
        exact: true,
      });
      await opener.click();
      const dialog = page.getByRole("dialog"),
        input = dialog.getByLabel("New project name");
      await expect(input).toBeFocused();
      await input.fill("保存設計の操作確認");
      await input.press("Shift+Tab");
      await expect(
        dialog.getByRole("button", { name: "Confirm", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
      await opener.click();
      await input.fill("編集設計の新規行");
      await input.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("cell", { name: "編集設計の新規行" }),
      ).toBeVisible();
    } else {
      const inputs = page.locator("input[required]"),
        submit = page.getByRole("button", {
          name: screen === "form" ? "Create project" : "Save changes",
          exact: true,
        });
      if (screen === "form") await submit.click();
      else {
        await inputs.nth(1).fill("invalid-email");
        await submit.click();
      }
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(
        screen === "form" ? inputs.first() : inputs.nth(1),
      ).toBeFocused();
      await inputs.first().fill("保存設計の日本語入力");
      await inputs
        .nth(1)
        .fill(screen === "form" ? "入力内容を保持" : "fixture@example.com");
      const checkbox = page.getByRole("checkbox", {
        name: "Notify me about project updates",
      });
      await checkbox.focus();
      await checkbox.press("Space");
      await expect(checkbox).not.toBeChecked();
      await inputs.first().focus();
      await inputs.first().press("Enter");
      await expect(
        page.getByRole("button", { name: "Saved in preview", exact: true }),
      ).toBeVisible();
      await expect(inputs.first()).toHaveValue("保存設計の日本語入力");
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
    expect(
      await page.locator("html").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
  }
  return results;
}

for (const width of [1440, 390])
  test(`edited saved intent → actual React ZIP → revised export at ${width}`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    mkdirSync(evidence, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/profile");
    await page.getByLabel("density-0", { exact: true }).selectOption("b");
    await page
      .getByLabel("density-0 理由", { exact: true })
      .fill("隔離fixture：日本語入力と一覧の情報量を優先");
    await page.getByLabel("質問を選ぶ", { exact: true }).selectOption("2");
    await page.getByLabel("roundness-0", { exact: true }).selectOption("a");
    await page.getByRole("button", { name: "DNA・原則", exact: true }).click();
    await page.getByRole("button", { name: "原則を追加", exact: true }).click();
    const principle = page.locator(".principle-fields").last();
    await principle
      .getByLabel("原則", { exact: true })
      .fill("本文・操作・一覧の読みやすさを保存値で比較する");
    await principle
      .getByLabel("理由", { exact: true })
      .fill("隔離fixtureの明示選択");
    await page
      .getByRole("button", { name: "共通の好みを保存", exact: true })
      .click();
    await expect(page.getByText("共通の好みを保存しました")).toBeVisible();
    const taste = (await (await page.request.get("/api/profile")).json())
      .current;
    await page.goto("/projects");
    await page
      .getByRole("button", { name: "新規プロジェクト", exact: true })
      .click();
    await page
      .getByLabel("プロジェクト名", { exact: true })
      .fill(`Edited export fixture ${width}`);
    await page.getByLabel("共通の好みを使う", { exact: true }).check();
    await page
      .getByRole("button", { name: "プロジェクトを作成", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `Edited export fixture ${width}`,
        exact: true,
      }),
    ).toBeVisible();
    const id = new URL(page.url()).pathname.split("/")[2],
      base = `/api/projects/${id}`;
    await edit(page, id, first);
    await page.getByRole("tab", { name: "Colors", exact: true }).click();
    const accentField = page
      .locator(".foundation-field")
      .filter({ has: page.getByLabel("accent", { exact: true }) });
    await accentField
      .getByText("適用範囲・例外・決定理由・出典", { exact: true })
      .click();
    await page
      .getByLabel("accent rationale", { exact: true })
      .fill("読みやすい青を利用者が指定");
    await page
      .getByLabel("accent source", { exact: true })
      .fill("隔離fixtureの手動選択");
    await page.getByLabel("accentをAI変更からロック", { exact: true }).check();
    await save(page, 2);
    await page.goto(`/projects/${id}/components`);
    await page.getByRole("button", { name: "Input", exact: true }).click();
    await page.getByLabel("size", { exact: true }).selectOption("lg");
    await save(page, 3);
    await page.getByRole("button", { name: "Button", exact: true }).click();
    await page.getByLabel("variant", { exact: true }).selectOption("subtle");
    await page.getByLabel("size", { exact: true }).selectOption("sm");
    await save(page, 4);
    await page.goto(`/projects/${id}/patterns`);
    await page
      .getByRole("button", { name: "FormSection", exact: true })
      .click();
    await page.getByLabel("余白 (px)", { exact: true }).fill("32");
    await save(page, 5);
    const savedA = (await (await page.request.get(`${base}/foundation`)).json())
      .current;
    const a = await download(page, id, 5);
    expect(a.json.design).toEqual(savedA.design);
    expect(a.json.taste.answers).toEqual(taste.snapshot.answers);
    expect(a.json.taste.reasons).toEqual(taste.snapshot.reasons);
    expect(a.json.taste.principles).toEqual(taste.snapshot.principles);
    expect(a.json.sourceTasteProfileRevision).toBe(taste.revision);
    expect(a.json.design.constraints.accent.rationale).toBe(
      "読みやすい青を利用者が指定",
    );
    expect(a.json.design.patterns.FormSection.gap).toBe(32);
    const markdown = readFileSync(join(a.directory, "DESIGN.md"), "utf8");
    expect(markdown).toContain(taste.snapshot.reasons["density-0"]);
    expect(markdown).toContain("読みやすい青を利用者が指定");
    const violations: unknown[] = [];
    const seenA = await verifyAppearance(
      page,
      id,
      a,
      width,
      "serif",
      violations,
    );

    await page.setViewportSize({ width: 1440, height: 1000 });
    await edit(page, id, second);
    const unsaved = await download(page, id, 5);
    expect(unsaved.record.id).toBe(a.record.id);
    expect(unsaved.bytes.equals(a.bytes)).toBe(true);
    expect(
      (await (await page.request.get(`${base}/foundation`)).json()).current,
    ).toEqual(savedA);
    await save(page, 6);
    await page.reload();
    await page.getByRole("tab", { name: "Typography", exact: true }).click();
    await expect(page.getByLabel("fontFamily", { exact: true })).toHaveValue(
      "monospace",
    );
    await expect(page.getByLabel("fontSize", { exact: true })).toHaveValue(
      "18",
    );
    const savedB = (await (await page.request.get(`${base}/foundation`)).json())
      .current;
    const b = await download(page, id, 6);
    expect(b.record.id).not.toBe(a.record.id);
    expect(b.bytes.equals(a.bytes)).toBe(false);
    expect(b.json.design).toEqual(savedB.design);
    expect(b.json.taste).toEqual(a.json.taste);
    const tokens = JSON.parse(
      readFileSync(join(b.directory, "tokens/tokens.json"), "utf8"),
    );
    expect(tokens["font-family"].$value).toBe("monospace");
    expect(tokens["font-size-body"].$value).toEqual({ value: 18, unit: "px" });
    expect(tokens["control-height"].$value).toEqual({ value: 40, unit: "px" });
    expect(
      readFileSync(join(b.directory, "tokens/variables.css"), "utf8"),
    ).toContain("--color-accent: #845034");
    const seenB = await verifyAppearance(
      page,
      id,
      b,
      width,
      "monospace",
      violations,
    );
    const reusedB = await download(page, id, 6);
    const oldA = await download(page, id, 5);
    expect(reusedB.record.id).toBe(b.record.id);
    expect(reusedB.bytes.equals(b.bytes)).toBe(true);
    expect(oldA.record).toEqual(a.record);
    expect(oldA.bytes.equals(a.bytes)).toBe(true);
    const history = (
      await (await page.request.get(`${base}/foundation`)).json()
    ).history;
    expect(
      history.find((item: { revision: number }) => item.revision === 5),
    ).toEqual(savedA);
    expect(
      (await (await page.request.get(`${base}/exports`)).json()).filter(
        (item: { templateVersion?: string }) =>
          item.templateVersion === "preview-11",
      ),
    ).toHaveLength(2);
    expect(errors).toEqual([]);
    expect(
      (await (await page.request.get("/api/health")).json()).codexCalls,
    ).toBe(0);
    writeFileSync(
      join(evidence, `verification-${width}.json`),
      JSON.stringify(
        {
          base: "07fcb5ba64c8e7046e7eda942ce55bbafe31c765",
          width,
          sourceTasteProfileRevision: taste.revision,
          templateVersion: "preview-11",
          revisions: [5, 6],
          zipSha256: { serif: sha(a.bytes), monospace: sha(b.bytes) },
          oldZipPreserved: true,
          unsavedExcluded: true,
          regeneratedZipReused: true,
          realAiCalls: 0,
          pageErrors: errors,
          visual: [...seenA, ...seenB],
          savedA,
          savedB,
          violations,
        },
        null,
        2,
      ),
    );
    expect(violations).toEqual([]);
  });
