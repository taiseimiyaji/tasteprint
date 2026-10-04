import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { ProjectService } from "../src/server/projects/service";
import { projectRoutes } from "../src/server/projects/routes";
import { briefSchema } from "../src/domain/projects";

it("adds persisted Export order to legacy and new replies across restart without rewriting stored bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-export-order-"));
  let service = new ProjectService(dir);
  try {
    const p = service.create(briefSchema.parse({ name: "Order" }), false);
    const legacy = {
      id: randomUUID(),
      projectId: p.id,
      revision: 1,
      sourceTasteProfileRevision: null,
      createdAt: "2027-01-01T00:00:00Z",
      files: { "old.json": "original bytes" },
      sequence: 999,
    };
    const raw = JSON.stringify(legacy);
    service
      .scope(p.id)
      .references.db.prepare("INSERT INTO exports VALUES (?,?)")
      .run(legacy.id, raw);
    expect(service.export(p.id, 1)).toEqual({ ...legacy, sequence: 1 });
    service.saveProject(p.id, 1, briefSchema.parse({ name: "Order r2" }), []);
    const simple = service.export(p.id, 2),
      bundle = await service.exportBundle(p.id, 2, "omit");
    expect(simple.sequence).toBe(2);
    expect(bundle.sequence).toBe(3);
    expect(service.export(p.id, 2)).toEqual(simple);
    expect(await service.exportBundle(p.id, 2, "omit")).toEqual(bundle);
    expect(service.project(p.id).latestExport?.sequence).toBe(3);
    const before = service
      .scope(p.id)
      .references.db.prepare("SELECT id,data FROM exports ORDER BY rowid")
      .all();
    expect(before[0].data).toBe(raw);
    expect(JSON.parse(String(before[1].data))).not.toHaveProperty("sequence");
    expect(JSON.parse(String(before[2].data))).not.toHaveProperty("sequence");
    await service.close();
    service = new ProjectService(dir);
    expect(service.exports(p.id).map((r) => r.sequence)).toEqual([3, 2, 1]);
    expect(service.export(p.id, 1)).toEqual({ ...legacy, sequence: 1 });
    expect(service.export(p.id, 2)).toEqual(simple);
    expect(await service.exportBundle(p.id, 2, "omit")).toEqual(bundle);
    expect(
      service
        .scope(p.id)
        .references.db.prepare("SELECT id,data FROM exports ORDER BY rowid")
        .all(),
    ).toEqual(before);
    const other = service.create(
      briefSchema.parse({ name: "Independent" }),
      false,
    );
    expect(service.export(other.id, 1).sequence).toBe(1);
    expect(service.exports(p.id).map((r) => r.sequence)).toEqual([3, 2, 1]);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("returns the same sequence through HTTP create, reuse, history and latest summary while downloads stay byte identical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-export-order-api-"));
  const service = new ProjectService(dir);
  try {
    const p = service.create(briefSchema.parse({ name: "HTTP Order" }), false);
    const app = new Hono().route("/api", projectRoutes(service, "fixture"));
    const pair = await app.request("http://localhost:3001/api/pair", {
      method: "POST",
      headers: {
        origin: "http://localhost:3001",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: "fixture" }),
    });
    const cookie = pair.headers.get("set-cookie")!.split(";")[0];
    const request = (path: string, data?: unknown) =>
      app.request(`http://localhost:3001/api${path}`, {
        method: data ? "POST" : "GET",
        headers: {
          cookie,
          origin: "http://localhost:3001",
          "content-type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    const base = `/projects/${p.id}`;
    for (const input of [
      { baseRevision: 1 },
      { baseRevision: 1, bundle: true, imageMode: "omit" },
    ]) {
      const response = await request(`${base}/exports`, input);
      expect(response.status).toBe(200);
      const first = await response.json(),
        again = await (await request(`${base}/exports`, input)).json();
      expect(again).toEqual(first);
      expect(first.sequence).toBe(input.bundle ? 2 : 1);
      expect(
        (await (await request(`${base}/exports`)).json())[0].sequence,
      ).toBe(first.sequence);
      expect(
        (await (await request(base)).json()).project.latestExport.sequence,
      ).toBe(first.sequence);
      const stored = service.exports(p.id).find((r) => r.id === first.id)!;
      const name = Object.keys(stored.files).find((n) =>
        n.endsWith(input.bundle ? ".zip" : ".json"),
      )!;
      const downloaded = await request(
        `${base}/exports/${first.id}/${encodeURIComponent(name)}`,
      );
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(
        Buffer.from(stored.files[name], input.bundle ? "base64" : "utf8"),
      );
    }
    expect(
      (await (await request("/projects")).json()).find(
        (r: { id: string }) => r.id === p.id,
      ).latestExport.sequence,
    ).toBe(2);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
