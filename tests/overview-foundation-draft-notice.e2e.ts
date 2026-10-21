import { test, expect } from "@playwright/test";

test("resuming Overview points to an unfinished Foundation draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "Resume draft notice" }, useTaste: false },
    })
  ).json();
  const other = await (
    await page.request.post("/api/projects", {
      data: { brief: { name: "No draft notice" }, useTaste: false },
    })
  ).json();
  await page.goto(`/projects/${project.id}/foundation`);
  const accent = page.getByRole("textbox", { name: "accent", exact: true });
  await accent.fill("#224466");
  await page.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(page.locator(".editor-actions")).toContainText(
    "保存済み · 設計 r2",
  );
  await page.goto(`/projects/${project.id}/overview`);
  await expect(
    page.getByRole("link", { name: "Foundationで下書きを確認" }),
  ).toHaveCount(0);

  await page.goto(`/projects/${project.id}/foundation`);
  await accent.fill("#335577");
  await expect(page.locator(".editor-actions")).toContainText(
    "下書き・未保存 · 設計 r2",
  );
  await page.goto("/projects");
  await page.reload();
  await page
    .locator(".project-list article")
    .filter({ has: page.getByRole("heading", { name: "Resume draft notice" }) })
    .getByRole("link", { name: "再開", exact: true })
    .click();
  await expect(page).toHaveURL(`/projects/${project.id}/overview`);
  await expect(page.locator(".editor-actions")).toContainText(
    "保存済み · 設計 r2",
  );
  const notice = page.getByText("設計の下書きがあります。", { exact: false });
  await expect(notice).toBeVisible();
  await page.getByRole("link", { name: "Foundationで下書きを確認" }).click();
  await expect(page).toHaveURL(`/projects/${project.id}/foundation`);
  await expect(accent).toHaveValue("#335577");
  expect(
    (await (await page.request.get(`/api/projects/${project.id}`)).json())
      .current.revision,
  ).toBe(2);
  await page.goto(`/projects/${other.id}/overview`);
  await expect(
    page.getByRole("link", { name: "Foundationで下書きを確認" }),
  ).toHaveCount(0);
  await page.evaluate(
    (id) => localStorage.setItem(`tasteprint.scope.${id}.draft.v1`, "{broken"),
    other.id,
  );
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Foundationで下書きを確認" }),
  ).toHaveCount(0);
  await page.goto(`/projects/${other.id}/foundation`);
  await expect(page.getByRole("alert")).toContainText(
    "設計の下書きを読み込めません",
  );
  expect(
    (await (await page.request.get("/api/health")).json()).codexCalls,
  ).toBe(0);
});
