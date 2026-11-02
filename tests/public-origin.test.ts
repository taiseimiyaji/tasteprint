import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { ProjectService } from "../src/server/projects/service";
import { projectRoutes } from "../src/server/projects/routes";
import { publicOrigin } from "../src/server/request-origin";

const external = "https://tasteprint.aromarevo.com";
const local = "http://127.0.0.1:47382";
const services: ProjectService[] = [];
function setup(origin: string | undefined = external) {
  const service = new ProjectService(
    mkdtempSync(join(tmpdir(), "tasteprint-origin-")),
  );
  services.push(service);
  const app = new Hono().route(
    "/api",
    projectRoutes(service, "fixture-code", [47382], origin),
  );
  const call = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("host")) headers.set("host", new URL(external).host);
    return app.request(local + "/api" + path, { ...init, headers });
  };
  const pair = (origin = external, host = new URL(external).host) =>
    call("/pair", {
      method: "POST",
      headers: {
        Host: host,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "fixture-code" }),
    });
  return { service, call, pair };
}
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.close();
    rmSync(service.directory, { recursive: true, force: true });
  }
});

describe("opt-in public origin with unchanged session pairing", () => {
  it.each([
    "http://tasteprint.aromarevo.com",
    "https://tasteprint.aromarevo.com/",
    "https://tasteprint.aromarevo.com/api",
    "https://tasteprint.aromarevo.com?x=1",
    "https://tasteprint.aromarevo.com#x",
    "https://user:pass@tasteprint.aromarevo.com",
    "https://*.aromarevo.com",
    "not-a-url",
  ])("rejects invalid public origin configuration %s", (value) => {
    expect(() => publicOrigin(value)).toThrow();
  });
  it("keeps public access disabled when the setting is absent", async () => {
    const service = new ProjectService(
      mkdtempSync(join(tmpdir(), "tasteprint-origin-")),
    );
    services.push(service);
    const app = new Hono().route(
      "/api",
      projectRoutes(service, "fixture-code", [47382]),
    );
    expect((await app.request(external + "/api/projects")).status).toBe(403);
    expect(publicOrigin()).toBeUndefined();
  });
  it("requires the code, issues a Secure host-only cookie, and allows authenticated reads/writes", async () => {
    const { call, pair, service } = setup();
    expect(
      (
        await call("/projects", {
          headers: { "Cf-Access-Jwt-Assertion": "not-app-authentication" },
        })
      ).status,
    ).toBe(401);
    const wrong = await call("/pair", {
      method: "POST",
      headers: { Origin: external, "Content-Type": "application/json" },
      body: '{"code":"wrong"}',
    });
    expect(wrong.status).toBe(403);
    const paired = await pair();
    expect(paired.status).toBe(200);
    const cookie = paired.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/Domain=/i);
    expect((await pair()).status).toBe(403);
    const headers = { Cookie: cookie.split(";")[0] };
    expect((await call("/projects", { headers })).status).toBe(200);
    const created = await call("/projects", {
      method: "POST",
      headers: {
        ...headers,
        Origin: external,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        brief: { name: "Public fixture" },
        useTaste: false,
      }),
    });
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(
      (await call(`/projects/${project.id}/foundation`, { headers })).status,
    ).toBe(200);
    expect(
      (await call(`/projects/${project.id}/references`, { headers })).status,
    ).toBe(200);
    expect(service.list()).toHaveLength(1);
  });
  it.each([
    undefined,
    "null",
    "http://tasteprint.aromarevo.com",
    "https://booq.aromarevo.com",
    "https://tasteprint.aromarevo.com.evil.test",
  ])(
    "rejects pairing with missing or mismatched Origin %s without consuming the code",
    async (origin) => {
      const { call, pair } = setup();
      const rejected = await call("/pair", {
        method: "POST",
        headers: {
          ...(origin ? { Origin: origin } : {}),
          "Content-Type": "application/json",
        },
        body: '{"code":"fixture-code"}',
      });
      expect(rejected.status).toBe(403);
      expect(rejected.headers.get("set-cookie")).toBeNull();
      expect((await pair()).status).toBe(200);
    },
  );
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "requires Origin for authenticated %s requests before a handler can mutate data",
    async (method) => {
      const { call, pair, service } = setup();
      const paired = await pair();
      const cookie = paired.headers.get("set-cookie")!.split(";")[0];
      const result = await call("/projects", {
        method,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: '{"brief":{"name":"Must not save"}}',
      });
      expect(result.status).toBe(403);
      expect(service.list()).toHaveLength(0);
      expect(
        (
          await call("/projects", {
            headers: { Cookie: cookie, Origin: "https://evil.test" },
          })
        ).status,
      ).toBe(403);
    },
  );
  it("rejects foreign Host and spoofed forwarding headers", async () => {
    const { call } = setup();
    for (const host of [
      "evil.test",
      "tasteprint.aromarevo.com.evil.test",
      "tasteprint.aromarevo.com:443",
    ]) {
      expect(
        (
          await call("/projects", {
            headers: {
              Host: host,
              Origin: external,
              "X-Forwarded-Host": new URL(external).host,
              "X-Forwarded-Proto": "https",
            },
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await call("/projects", {
          headers: {
            Host: "127.0.0.1:47382",
            Origin: external,
            "X-Forwarded-Host": new URL(external).host,
          },
        })
      ).status,
    ).toBe(403);
  });
  it("does not expose nested pairing routes as authentication exemptions", async () => {
    const { call, service } = setup();
    const project = service.create(
      {
        name: "Existing fixture",
        purpose: "",
        audience: "",
        desired: "",
        avoid: "",
      },
      false,
    );
    const result = await call(`/projects/${project.id}/references/pair`, {
      method: "POST",
      headers: { Origin: external, "Content-Type": "application/json" },
      body: '{"code":""}',
    });
    expect(result.status).toBe(401);
    expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("preserves localhost HTTP pairing with a non-Secure cookie while requiring write Origin", async () => {
    const { call, pair, service } = setup();
    const paired = await pair(local, "127.0.0.1:47382");
    expect(paired.status).toBe(200);
    const cookie = paired.headers.get("set-cookie")!;
    expect(cookie).not.toContain("Secure");
    const headers = {
      Host: "127.0.0.1:47382",
      Cookie: cookie.split(";")[0],
      "Content-Type": "application/json",
    };
    expect(
      (
        await call("/projects", {
          method: "POST",
          headers,
          body: '{"brief":{"name":"Missing Origin"}}',
        })
      ).status,
    ).toBe(403);
    expect(service.list()).toHaveLength(0);
    expect(
      (
        await call("/projects", {
          method: "POST",
          headers: { ...headers, Origin: local },
          body: '{"brief":{"name":"Local fixture"},"useTaste":false}',
        })
      ).status,
    ).toBe(201);
  });
});
