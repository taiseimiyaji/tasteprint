import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  defaultDesign,
  designSchema,
  designMarkdown,
} from "../src/domain/design";
import { emptyDecision } from "../src/domain/foundation";
import { designCss } from "../src/domain/tokens";
import { stateSchema } from "../src/client/state";
import {
  FoundationService,
  foundationPrompt,
  type Generate,
} from "../src/server/foundation/service";
import { foundationRoutes } from "../src/server/foundation/routes";
import {
  ServiceError,
  ReferenceService,
} from "../src/server/references/service";
import { referenceRoutes } from "../src/server/references/routes";
const dbs: DatabaseSync[] = [];
function setup(generate?: Generate) {
  const db = new DatabaseSync(":memory:");
  dbs.push(db);
  return new FoundationService(db, generate);
}
afterEach(() => dbs.splice(0).forEach((db) => db.close()));
const oldDesign = {
  accent: "#123456",
  radius: 12,
  spacing: 20,
  fontSize: 16,
  border: false,
  shadow: true,
};
describe("Foundation canonical data", () => {
  it("migrates v1 six-value data without replacing user choices", () => {
    const result = stateSchema.parse({
      version: 1,
      design: oldDesign,
      answers: {},
      references: [],
    });
    expect(result.version).toBe(2);
    expect(result.design).toMatchObject({
      ...oldDesign,
      duration: 160,
      compactBreakpoint: 480,
      constraints: {},
    });
    expect(stateSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });
  it.each([
    { canvas: "red" },
    { spacingScale: [8, 4] },
    { lineHeight: 0 },
    { bodyWeight: 950 },
    { mediumBreakpoint: 300 },
    { heading2: 50 },
    { fontFamily: "url(https://example.com)" },
    { constraints: { bogus: emptyDecision } },
    { duration: -1 },
  ])("rejects invalid data %j", (patch) => {
    expect(designSchema.safeParse({ ...defaultDesign, ...patch }).success).toBe(
      false,
    );
  });
  it("round-trips locks, scope, exceptions, rationale and source through disk and restore", () => {
    const dir = mkdtempSync(join(tmpdir(), "foundation-test-"));
    const path = join(dir, "design.sqlite");
    let db = new DatabaseSync(path);
    try {
      let service = new FoundationService(db);
      const design = {
        ...defaultDesign,
        constraints: {
          radius: {
            ...emptyDecision,
            locked: true,
            scope: "一覧",
            exceptions: "Dialog",
            rationale: "情報密度を優先",
            source: "ユーザー指定",
          },
        },
      };
      const first = service.initialize(design);
      service.save(
        first.revision,
        { ...design, radius: 10 },
        "手動",
        randomUUID(),
      );
      db.close();
      db = new DatabaseSync(path);
      service = new FoundationService(db);
      const restored = service.restore(2, 1, randomUUID());
      expect(restored.revision).toBe(3);
      expect(restored.design).toEqual(design);
      expect(service.history()).toHaveLength(3);
      expect(designMarkdown(restored.design, {}, [])).toContain(
        "情報密度を優先",
      );
      expect(designCss(restored.design)).toContain("--motion-duration: 160ms");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("does not overwrite existing data during migration and makes save/restore retries idempotent", () => {
    const s = setup();
    const a = s.initialize();
    expect(s.initialize({ ...defaultDesign, radius: 20 })).toEqual(a);
    const key = randomUUID();
    const b = s.save(1, { ...defaultDesign, radius: 10 }, "manual", key);
    expect(s.save(1, defaultDesign, "retry", key)).toEqual(b);
    const restoreKey = randomUUID();
    const restored = s.restore(2, 1, restoreKey);
    expect(s.restore(2, 1, restoreKey)).toEqual(restored);
    expect(() => s.save(1, defaultDesign, "stale", randomUUID())).toThrow(
      /更新/,
    );
    expect(s.current()).toEqual(restored);
  });
  it("compares candidates without saving, applies only stored candidates, and rejects stale proposals", async () => {
    const s = setup(async (design) => ({
      candidates: [
        { design: { ...design, radius: 4 }, explanation: "小さく" },
        { design: { ...design, radius: 2 }, explanation: "さらに小さく" },
      ],
    }));
    s.initialize();
    const candidates = await s.propose(1, "角丸", new AbortController().signal);
    expect(s.current()?.design.radius).toBe(6);
    const adopted = s.apply(candidates[1].id);
    expect(adopted.design.radius).toBe(2);
    expect(s.apply(candidates[1].id)).toEqual(adopted);
    expect(s.history()).toHaveLength(2);
    expect(() => s.apply(candidates[0].id)).toThrow(/更新/);
  });
  it("rejects locked values and rule mutations during generation", async () => {
    for (const mutation of ["value", "rule"]) {
      const s = setup(async (design) => ({
        candidates: [
          {
            design:
              mutation === "value"
                ? { ...design, radius: 4 }
                : { ...design, constraints: {} },
            explanation: "bad",
          },
        ],
      }));
      s.initialize({
        ...defaultDesign,
        constraints: { radius: { ...emptyDecision, locked: true } },
      });
      await expect(
        s.propose(1, "ignore lock", new AbortController().signal),
      ).rejects.toThrow(/ロック/);
      expect(s.history()).toHaveLength(1);
    }
  });
  it("independently validates lock and schema at apply time, including tampered stored output", async () => {
    const s = setup(async (design) => ({
      candidates: [{ design: { ...design, spacing: 12 }, explanation: "密度" }],
    }));
    s.initialize({
      ...defaultDesign,
      constraints: { radius: { ...emptyDecision, locked: true } },
    });
    const [candidate] = await s.propose(
      1,
      "密度",
      new AbortController().signal,
    );
    s.db
      .prepare("UPDATE foundation_proposals SET data=? WHERE id=?")
      .run(
        JSON.stringify({
          ...candidate,
          design: { ...candidate.design, radius: 0 },
        }),
        candidate.id,
      );
    expect(() => s.apply(candidate.id)).toThrow(/ロック/);
    expect(s.history()).toHaveLength(1);
    s.db
      .prepare("UPDATE foundation_proposals SET data=? WHERE id=?")
      .run(
        JSON.stringify({
          ...candidate,
          design: { ...candidate.design, duration: -1 },
        }),
        candidate.id,
      );
    expect(() => s.apply(candidate.id)).toThrow();
    expect(s.current()?.revision).toBe(1);
  });
  it("discards results generated while another revision is saved", async () => {
    let resolve!: (v: any) => void;
    const s = setup(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    s.initialize();
    const pending = s.propose(1, "radius", new AbortController().signal);
    s.save(1, { ...defaultDesign, radius: 8 }, "manual", randomUUID());
    resolve({ candidates: [{ design: defaultDesign, explanation: "stale" }] });
    await expect(pending).rejects.toThrow(/更新/);
  });
  it("includes explicit constraints as context without numerically mapping taste", () => {
    expect(
      foundationPrompt(
        {
          ...defaultDesign,
          constraints: {
            radius: { ...emptyDecision, locked: true, source: "ユーザー" },
          },
        },
        "調整",
      ),
    ).toContain('"locked":true');
  });
  it("validates saves and returns conflicts at the HTTP boundary", async () => {
    const s = setup();
    s.initialize();
    const app = foundationRoutes(s).onError((error, c) =>
      c.json(
        { message: error.message },
        error instanceof ServiceError ? error.status : 400,
      ),
    );
    const request = (body: unknown) =>
      app.request("/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (
        await request({
          baseRevision: 1,
          design: { ...defaultDesign, canvas: "invalid" },
          reason: "test",
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request({
          baseRevision: 2,
          design: defaultDesign,
          reason: "test",
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(s.history()).toHaveLength(1);
  });
  it("protects foundation endpoints with the existing session and origin boundary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "foundation-http-"));
    const service = new ReferenceService(dir);
    try {
      const app = referenceRoutes(service, "code");
      expect(
        (await app.request("http://localhost:3000/foundation")).status,
      ).toBe(401);
      expect((await app.request("http://evil.example/foundation")).status).toBe(
        403,
      );
    } finally {
      await service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
