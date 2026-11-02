import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { ProjectService } from "../src/server/projects/service";
import { projectRoutes } from "../src/server/projects/routes";

test("public HTTPS pairing persists a Secure cookie that is never sent over HTTP", async ({
  browser,
}) => {
  const origin = "https://tasteprint.aromarevo.com";
  const directory = mkdtempSync(join(tmpdir(), "tasteprint-browser-origin-"));
  const service = new ProjectService(directory);
  const app = new Hono().route(
    "/api",
    projectRoutes(service, "fixture-code", [47382], origin),
  );
  app.get("/", (c) =>
    c.html(`<!doctype html><html><body>
    <form><label>Connection code<input name="code"></label><button>Connect</button></form>
    <output></output><script>
    document.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const response = await fetch('/api/pair', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:document.querySelector('input').value})});
      document.querySelector('output').textContent = String(response.status);
    };
    </script></body></html>`),
  );
  const context = await browser.newContext({ extraHTTPHeaders: {} });
  const requests: { protocol: string; cookie: boolean }[] = [];
  const unexpectedOrigins: string[] = [];
  try {
    // This virtual proxy never connects to DNS, Cloudflare or another machine.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname !== "tasteprint.aromarevo.com") {
        unexpectedOrigins.push(url.origin);
        return route.abort();
      }
      const headers = await request.allHeaders();
      requests.push({ protocol: url.protocol, cookie: !!headers.cookie });
      const response = await app.fetch(
        new Request(request.url(), {
          method: request.method(),
          headers,
          ...(request.postData() ? { body: request.postData()! } : {}),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByLabel("Connection code").fill("fixture-code");
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.locator("output")).toHaveText("200");
    const cookies = await context.cookies(origin);
    expect(cookies).toEqual([
      expect.objectContaining({
        name: "tasteprint_session",
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
        domain: "tasteprint.aromarevo.com",
      }),
    ]);
    expect(
      await page.evaluate(async () => (await fetch("/api/projects")).status),
    ).toBe(200);
    await page.reload();
    expect(
      await page.evaluate(async () => (await fetch("/api/projects")).status),
    ).toBe(200);
    await page.goto("http://tasteprint.aromarevo.com");
    expect(
      await page.evaluate(async () => (await fetch("/api/projects")).status),
    ).toBe(401);
    expect(
      requests.filter((r) => r.protocol === "https:" && r.cookie).length,
    ).toBeGreaterThan(0);
    expect(requests.filter((r) => r.protocol === "http:" && r.cookie)).toEqual(
      [],
    );
    expect(unexpectedOrigins).toEqual([]);
  } finally {
    await context.close();
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
