import { test, expect } from "@playwright/test";

test("a deleted URL Reference is removed after its delayed create receipt", async ({
  page,
}) => {
  const created = await page.request.post("/api/projects", {
    data: { brief: { name: "Concurrent Reference delete" }, useTaste: false },
  });
  const project = await created.json();
  const base = `/api/projects/${project.id}/references`;
  const otherResponse = await page.request.post(base, {
    data: {
      name: "Polling reference",
      url: "https://example.com/e2e-pending",
      selections: [{ aspect: "Typography", intent: "reference" }],
      likes: "",
      dislikes: "",
    },
  });
  expect(otherResponse.ok()).toBe(true);
  const other = await otherResponse.json();
  const jobResponse = await page.request.post(`${base}/${other.id}/jobs`, {
    data: { version: other.version, type: "capture", key: crypto.randomUUID() },
  });
  expect(jobResponse.ok()).toBe(true);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  let receipt!: { id: string; version: number };
  let posts = 0;
  let failRead = false;
  await page.route(`**${base}`, async (route) => {
    if (route.request().method() === "GET" && failRead)
      return route.fulfill({
        status: 503,
        json: { message: "List read failed" },
      });
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    receipt = await response.json();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  const name = `concurrent-${crypto.randomUUID()}.example`;
  await page.goto(`/projects/${project.id}/inspiration`);
  await page
    .getByRole("textbox", { name: "Reference URL" })
    .fill(`https://${name}/`);
  await page.getByRole("button", { name: "参考を追加" }).click();
  await started;
  const card = page.locator(".reference-card").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });
  const otherCard = page.locator(".reference-card").filter({
    has: page.getByRole("heading", { name: other.name, exact: true }),
  });
  await expect(card).toBeVisible();
  const failedRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === base &&
      response.request().method() === "GET" &&
      response.status() === 503,
  );
  failRead = true;
  await failedRead;
  await expect(card).toBeVisible();
  const deleted = await page.request.delete(`${base}/${receipt.id}`, {
    data: { version: receipt.version },
  });
  expect(deleted.ok()).toBe(true);
  const job = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${base}/${receipt.id}/jobs`,
  );
  release();
  expect((await job).status()).toBe(404);
  await expect(page.getByRole("button", { name: "参考を追加" })).toBeEnabled();
  const references = (await (await page.request.get(base)).json()).references;
  expect(references.some((r: { id: string }) => r.id === receipt.id)).toBe(
    false,
  );
  await expect(card).toHaveCount(0);
  await expect(otherCard).toBeVisible();
  expect(posts).toBe(1);
  failRead = false;
  await page.reload();
  await expect(card).toHaveCount(0);
  await expect(otherCard).toBeVisible();
});
