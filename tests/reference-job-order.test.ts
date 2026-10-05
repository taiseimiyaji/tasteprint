import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ReferenceService } from "../src/server/references/service";
import { referenceRoutes } from "../src/server/references/routes";
const input = {
  name: "Job order",
  url: "https://example.com",
  selections: [{ aspect: "Typography" as const, intent: "reference" as const }],
  likes: "",
  dislikes: "",
};
const pending = async (_url: string, signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
  });

it("HTTP replies, list, idempotency and restart derive creation/transition order without changing stored metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-reference-order-"));
  let service = new ReferenceService(dir, pending);
  try {
    const routes = referenceRoutes(
      service,
      "fixture",
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    const ref = service.create(input);
    const url = "http://127.0.0.1:3000";
    const post = async (path: string, body: unknown = {}) => {
      const response = await routes.request(url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.ok).toBe(true);
      return response.json();
    };
    const a = await post(`/${ref.id}/jobs`, {
      version: 1,
      type: "capture",
      key: randomUUID(),
    });
    expect(a.createdSequence).toBeGreaterThan(0);
    expect(a.transitionSequence).toBeGreaterThanOrEqual(a.createdSequence);
    expect(
      service.events(a.id, 0).find((e) => e.sequence === a.transitionSequence)
        ?.state,
    ).toBe(a.state);
    expect(service.job(a.id).transitionSequence).toBeGreaterThan(
      a.transitionSequence,
    );
    const ar = await post(`/jobs/${a.id}/cancel`);
    expect(ar.transitionSequence).toBeGreaterThan(a.transitionSequence);
    const key = randomUUID();
    const b = await post(`/${ref.id}/jobs`, {
      version: 1,
      type: "capture",
      key,
    });
    const original = JSON.parse(
      String(
        service.db.prepare("SELECT data FROM jobs WHERE id=?").get(b.id)!.data,
      ),
    );
    service.db.prepare("UPDATE jobs SET data=? WHERE id=?").run(
      JSON.stringify({
        ...original,
        extra: { original: true },
        createdAt: "1970-01-01T00:00:00Z",
      }),
      b.id,
    );
    const br = await post(`/jobs/${b.id}/cancel`);
    expect(br.extra).toEqual({ original: true });
    expect(br.createdSequence).toBeGreaterThan(ar.createdSequence);
    expect(br.transitionSequence).toBeGreaterThan(b.transitionSequence);
    const earlier = service.job(a.id);
    service.db.prepare("INSERT OR REPLACE INTO jobs VALUES (?,?)").run(
      a.id,
      JSON.stringify({
        ...earlier,
        createdSequence: 999999,
        transitionSequence: 999999,
        extra: "legacy raw marker",
      }),
    );
    const raw = service.db
      .prepare("SELECT id,data FROM jobs ORDER BY id")
      .all();
    const events = service.db
      .prepare("SELECT * FROM events ORDER BY sequence")
      .all();
    expect(service.jobs().map((j) => j.id)).toEqual([a.id, b.id]);
    expect(service.job(a.id).createdSequence).toBe(a.createdSequence);
    expect(service.job(a.id).transitionSequence).toBe(ar.transitionSequence);
    expect(
      await post(`/${ref.id}/jobs`, { version: 1, type: "capture", key }),
    ).toEqual(br);
    expect(
      (await (await routes.request(url + "/")).json()).jobs.map(
        (j: { id: string }) => j.id,
      ),
    ).toEqual([a.id, b.id]);
    expect(
      (await (await routes.request(url + `/jobs/${b.id}`)).json()).job,
    ).toEqual(br);
    const rawB = JSON.parse(String(raw.find((r) => r.id === b.id)!.data));
    expect(rawB).not.toHaveProperty("createdSequence");
    expect(rawB).not.toHaveProperty("transitionSequence");
    await service.close();
    service = new ReferenceService(dir, pending);
    expect(service.jobs().map((j) => j.id)).toEqual([a.id, b.id]);
    expect(service.job(b.id)).toEqual(br);
    expect(
      service.db.prepare("SELECT id,data FROM jobs ORDER BY id").all(),
    ).toEqual(raw);
    expect(
      service.db.prepare("SELECT * FROM events ORDER BY sequence").all(),
    ).toEqual(events);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("legacy jobs without queued events keep unknown creation order and raw terminal snapshots on restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-reference-legacy-order-"));
  let service = new ReferenceService(dir, pending);
  try {
    const ref = service.create(input);
    const terminal = {
      id: randomUUID(),
      referenceId: ref.id,
      input: ref,
      type: "capture",
      state: "failed",
      createdAt: "old",
      updatedAt: "old",
      extra: { original: true },
      createdSequence: 999,
      transitionSequence: 999,
    };
    const active = {
      ...terminal,
      id: randomUUID(),
      state: "running",
      createdSequence: undefined,
      transitionSequence: undefined,
    };
    const raw = JSON.stringify(terminal);
    service.db.prepare("INSERT INTO jobs VALUES (?,?)").run(terminal.id, raw);
    service.db
      .prepare("INSERT INTO jobs VALUES (?,?)")
      .run(active.id, JSON.stringify(active));
    expect(service.job(terminal.id)).toMatchObject({
      createdSequence: 0,
      transitionSequence: 0,
      extra: terminal.extra,
    });
    await service.close();
    service = new ReferenceService(dir, pending);
    expect(service.job(active.id)).toMatchObject({
      state: "interrupted",
      createdSequence: 0,
      extra: terminal.extra,
    });
    expect(service.job(active.id).transitionSequence).toBeGreaterThan(0);
    expect(service.events(active.id, 0).map((e) => e.state)).toEqual([
      "interrupted",
    ]);
    expect(service.jobs().map((j) => j.id)).toEqual([terminal.id, active.id]);
    expect(service.cancel(terminal.id)).toMatchObject({
      createdSequence: 0,
      transitionSequence: 0,
    });
    expect(
      service.db.prepare("SELECT data FROM jobs WHERE id=?").get(terminal.id)!
        .data,
    ).toBe(raw);
    const updated = JSON.parse(
      String(
        service.db.prepare("SELECT data FROM jobs WHERE id=?").get(active.id)!
          .data,
      ),
    );
    expect(updated).not.toHaveProperty("createdSequence");
    expect(updated).not.toHaveProperty("transitionSequence");
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
