import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ProjectService } from "../src/server/projects/service";
import { ReferenceService } from "../src/server/references/service";
import { FoundationService } from "../src/server/foundation/service";
import { projectRoutes } from "../src/server/projects/routes";
import { Hono } from "hono";
import { briefSchema } from "../src/domain/projects";
import { defaultDesign } from "../src/domain/design";
import { initialState } from "../src/client/state";
const dirs: string[] = [],
  services: ProjectService[] = [];
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-projects-"));
  dirs.push(dir);
  const s = new ProjectService(dir, {
    generate: async (design) => ({
      candidates: [{ design: { ...design, radius: 3 }, explanation: "small" }],
    }),
  });
  services.push(s);
  return s;
};
const principle = (text = "一覧は行と区切り線を優先") => ({
  id: "list",
  target: "list",
  text,
  reason: "一覧性",
  sources: ["https://example.com"],
  locked: false,
});
const taste = (s: ProjectService, text?: string) =>
  s.saveTaste(s.taste().revision, {
    answers: { "density-0": "b" },
    reasons: { "density-0": "一覧性" },
    principles: [principle(text)],
  });
const create = (s: ProjectService, name = "Project") =>
  s.create(briefSchema.parse({ name }), true, s.taste().revision);
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe("project scope and immutable snapshots", () => {
  it("persists taste without any project and creates independent project histories and exports", async () => {
    const s = setup();
    const t = taste(s);
    expect(s.list()).toEqual([]);
    const a = create(s, "Admin"),
      b = create(s, "Site");
    expect(s.revision(a.id).snapshot.taste).toEqual(t.snapshot);
    s.saveProject(b.id, 1, b.brief, [
      { ...principle("作品一覧はカード"), id: "site-list" },
    ]);
    s.addConversation(b.id, 2, "サイトだけ変更");
    expect(s.revision(a.id).revision).toBe(1);
    expect(s.conversations(a.id)).toEqual([]);
    expect(s.taste()).toEqual(t);
    const e = s.export(a.id, 1);
    const bytes = JSON.stringify(e.files);
    taste(s, "装飾を控える");
    expect(JSON.stringify(s.export(a.id, 1).files)).toBe(bytes);
    expect(s.revision(a.id).snapshot.taste).toEqual(t.snapshot);
    const c = create(s, "New");
    expect(s.revision(c.id).snapshot.sourceTasteProfileRevision).toBe(
      s.taste().revision,
    );
    expect(Object.keys(s.export(b.id, 2).files)[0]).not.toEqual(
      Object.keys(e.files)[0],
    );
    const dir = s.directory;
    await s.close();
    services.pop();
    const restarted = new ProjectService(dir);
    services.push(restarted);
    expect(restarted.taste().revision).toBe(3);
    expect(restarted.revision(b.id).snapshot.policies[0].text).toBe(
      "作品一覧はカード",
    );
    expect(restarted.export(a.id, 1).files).toEqual(e.files);
  });
  it("requires complete latest diff decisions and protects explicit policies and locks without regenerating tokens", () => {
    const s = setup();
    taste(s);
    const a = create(s),
      b = create(s);
    s.saveProject(b.id, 1, b.brief, [
      { ...principle("カードを使う"), id: "own" },
    ]);
    const f = s.scope(b.id).foundation;
    const r = f.current()!;
    f.save(
      r.revision,
      {
        ...r.design,
        constraints: {
          radius: {
            locked: true,
            scope: "all",
            exceptions: "",
            rationale: "固定",
            source: "user",
            author: "user",
          },
        },
      },
      "lock",
      randomUUID(),
    );
    const latest = s.saveTaste(s.taste().revision, {
      answers: { "roundness-0": "a" },
      reasons: {},
      principles: [
        principle("行だけ"),
        { ...principle("角丸控えめ"), id: "radius", target: "radius" },
      ],
    });
    const diff = s.diff(b.id);
    expect(diff.changes.some((d) => d.kind === "削除")).toBe(true);
    expect(diff.changes.some((d) => d.conflict?.includes("カード"))).toBe(true);
    expect(diff.changes.some((d) => d.conflict?.includes("radius"))).toBe(true);
    expect(() => s.adopt(b.id, 3, latest.revision, {})).toThrow("すべて");
    expect(() =>
      s.adopt(
        b.id,
        3,
        latest.revision,
        Object.fromEntries(diff.changes.map((d) => [d.key, "adopt"])),
      ),
    ).toThrow("競合");
    const choices = Object.fromEntries(
      diff.changes.map((d) => [d.key, d.conflict ? "keep" : "adopt"]),
    ) as Record<string, "adopt" | "keep">;
    const old = s.revision(b.id);
    s.adopt(b.id, 3, latest.revision, choices);
    expect(s.revision(b.id).design).toEqual(old.design);
    expect(s.revision(b.id).snapshot.maintained.length).toBeGreaterThan(0);
    expect(s.revision(a.id).revision).toBe(1);
    expect(() => s.adopt(b.id, 3, latest.revision, choices)).toThrow("更新");
    taste(s);
    expect(() => s.adopt(b.id, 4, latest.revision, choices)).toThrow("共通");
  });
  it("promotes only explicitly selected saved principles with reasons and sources", () => {
    const s = setup();
    taste(s);
    const a = create(s),
      b = create(s);
    s.saveProject(a.id, 1, { ...a.brief, purpose: "PRIVATE BRIEF" }, [
      { ...principle("カード"), id: "own" },
    ]);
    s.addConversation(a.id, 2, "PRIVATE CHAT");
    s.promote(a.id, 2, s.taste().revision, ["own"]);
    const exported = JSON.stringify(s.taste());
    expect(exported).not.toContain("PRIVATE");
    expect(s.revision(b.id).snapshot.taste.principles).toHaveLength(1);
    expect(s.taste().snapshot.principles).toHaveLength(2);
  });
  it("scopes proposal IDs, requests, reviews, images, references and jobs", async () => {
    const s = setup(),
      a = create(s),
      b = create(s);
    const fa = s.scope(a.id).foundation,
      fb = s.scope(b.id).foundation;
    const [proposal] = await fa.propose(
      1,
      "small",
      new AbortController().signal,
    );
    expect(() => fb.apply(proposal.id)).toThrow("見つかりません");
    fa.apply(proposal.id);
    const key = randomUUID();
    fa.save(2, { ...fa.current()!.design, radius: 4 }, "a", key);
    expect(
      fb.save(1, { ...defaultDesign, radius: 8 }, "b", key).design.radius,
    ).toBe(8);
    const ref = s.scope(a.id).references.create({
      name: "a",
      url: "https://example.com",
      selections: [{ aspect: "Typography", intent: "reference" }],
      likes: "",
      dislikes: "",
    });
    expect(() => s.scope(b.id).references.reference(ref.id)).toThrow();
    expect(() => s.scope(b.id).reviews.image(randomUUID())).toThrow();
    s.archive(a.id, 3, true);
    expect(() =>
      s.scope(a.id).foundation.save(3, defaultDesign, "bad", randomUUID()),
    ).toThrow("アーカイブ");
    s.archive(a.id, 3, false);
    expect(s.revision(a.id).revision).toBe(3);
  });
  it("rejects late AI results and policy changes", async () => {
    const s = setup(),
      a = create(s);
    let release!: (v: unknown) => void;
    const scope = s.scope(a.id),
      f = new FoundationService(scope.references.db, async (design) => {
        await new Promise((r) => (release = r));
        return {
          candidates: [
            { design: { ...design, radius: 1 }, explanation: "late" },
          ],
        };
      });
    const pending = f.propose(1, "late", new AbortController().signal);
    scope.foundation.save(
      1,
      { ...defaultDesign, radius: 8 },
      "new",
      randomUUID(),
    );
    release(null);
    await expect(pending).rejects.toThrow("更新");
  });
});
describe("backed up and repeatable migration", () => {
  it("backs up SQLite including all history, proposals and idempotency keys; interrupts old jobs in legacy scope", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasteprint-migrate-"));
    dirs.push(dir);
    const old = new ReferenceService(dir),
      f = new FoundationService(old.db, async (design) => ({
        candidates: [{ design: { ...design, radius: 2 }, explanation: "old" }],
      }));
    f.initialize({ ...defaultDesign, radius: 11 });
    f.save(1, { ...defaultDesign, radius: 12 }, "history", randomUUID());
    const [candidate] = await f.propose(2, "old", new AbortController().signal);
    const ref = old.create({
      name: "legacy",
      url: "https://example.com",
      likes: "",
      dislikes: "",
      selections: [{ aspect: "Colors", intent: "reference" }],
    });
    old.db.prepare("INSERT INTO jobs VALUES (?,?)").run(
      "old-job",
      JSON.stringify({
        id: "old-job",
        referenceId: ref.id,
        input: ref,
        type: "capture",
        state: "running",
        createdAt: "then",
        updatedAt: "then",
      }),
    );
    await old.close();
    const s = new ProjectService(dir);
    services.push(s);
    expect(
      existsSync(join(dir, "backup-before-projects", "references.sqlite")),
    ).toBe(true);
    expect(
      s
        .scope("legacy")
        .foundation.history()
        .map((r) => r.design.radius),
    ).toEqual([11, 12]);
    expect(s.scope("legacy").references.jobs()[0].state).toBe("interrupted");
    expect(s.shared.references()).toEqual([]);
    await s.importBrowser({
      ...initialState,
      design: { ...defaultDesign, radius: 5 },
      answers: { "density-0": "a" },
      references: [],
    });
    expect(s.revision("legacy").design.radius).toBe(12);
    expect(s.taste().snapshot.answers["density-0"]).toBe("a");
    expect(s.taste().snapshot.principles).toEqual([]);
    const count = s.scope("legacy").foundation.history().length;
    await s.importBrowser({
      ...initialState,
      design: { ...defaultDesign, radius: 5 },
      answers: { "density-0": "a" },
      references: [],
    });
    expect(s.scope("legacy").foundation.history()).toHaveLength(count);
    expect(
      s
        .scope("legacy")
        .references.db.prepare("SELECT id FROM foundation_proposals WHERE id=?")
        .get(candidate.id),
    ).toBeTruthy();
    await s.close();
    services.pop();
    const again = new ProjectService(dir);
    services.push(again);
    expect(again.list()).toHaveLength(1);
    expect(again.scope("legacy").foundation.history()).toHaveLength(count);
  });
  it("migrates browser-only design and keeps original payload and scoped references exactly once", async () => {
    const s = setup(),
      raw = {
        ...initialState,
        design: { ...defaultDesign, radius: 17 },
        answers: { "density-0": "b" },
        references: [
          {
            id: "old",
            name: "old",
            url: "https://example.com",
            aspects: ["Colors"],
          },
        ],
      };
    const result = await s.importBrowser(raw);
    expect(s.revision(result.projectId).design.radius).toBe(17);
    expect(s.scope(result.projectId).references.references()).toHaveLength(1);
    expect(s.shared.references()).toEqual([]);
    expect(
      JSON.parse(
        readFileSync(
          join(s.directory, "backup-before-projects", `${result.backup}.json`),
          "utf8",
        ),
      ),
    ).toEqual(raw);
    await s.importBrowser(raw);
    expect(s.list()).toHaveLength(1);
    expect(s.scope(result.projectId).references.references()).toHaveLength(1);
  });
});
it("enforces authenticated project routes, ownership, stale versions, and immutable download IDs", async () => {
  const s = setup(),
    app = new Hono().route("/api", projectRoutes(s, "pair", [3000]));
  const origin = "http://localhost:3000";
  const paired = await app.request(origin + "/api/pair", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "pair" }),
  });
  expect(paired.status).toBe(200);
  const cookie = paired.headers.get("set-cookie")!.split(";")[0];
  const call = (path: string, body?: unknown) =>
    app.request(origin + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  expect((await app.request(origin + "/api/projects")).status).toBe(401);
  const a = create(s),
    b = create(s),
    ref = s.scope(a.id).references.create({
      name: "private",
      url: "",
      selections: [{ aspect: "Colors", intent: "reference" }],
      likes: "",
      dislikes: "",
    });
  expect(
    (await call(`/projects/${b.id}/references/${ref.id}/image`)).status,
  ).toBe(404);
  expect(
    (
      await call(`/projects/${a.id}/foundation/save`, {
        baseRevision: 99,
        design: defaultDesign,
        reason: "bad",
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(409);
  expect((await call(`/projects/${randomUUID()}/foundation`)).status).toBe(404);
  const e = s.export(a.id, 1),
    file = Object.keys(e.files)[0];
  expect((await call(`/projects/${b.id}/exports/${e.id}/${file}`)).status).toBe(
    404,
  );
  expect((await call(`/projects/${a.id}/exports/${e.id}/${file}`)).status).toBe(
    200,
  );
  expect((await call("/profile/references/foundation")).status).toBe(404);
});

it("keeps a profile across restart without creating projects", async () => {
  const s = setup();
  taste(s);
  const dir = s.directory;
  await s.close();
  services.pop();
  const restarted = new ProjectService(dir);
  services.push(restarted);
  expect(restarted.list()).toEqual([]);
  expect(restarted.taste().snapshot.answers["density-0"]).toBe("b");
});
it("reviews shared reference deletion separately and retains old adopted evidence", () => {
  const s = setup();
  const ref = s.shared.create({
    name: "shared",
    url: "https://example.com",
    selections: [{ aspect: "Colors", intent: "reference" }],
    likes: "colors",
    dislikes: "",
  });
  const findings = [
    {
      aspect: "Colors",
      observation: "observed",
      interpretation: "adopted interpretation",
      recommendation: "adopted recommendation",
      certainty: "medium",
      evidence: "old evidence",
    },
    {
      aspect: "Colors",
      observation: "unadopted",
      interpretation: "unadopted interpretation",
      recommendation: "unadopted recommendation",
      certainty: "low",
      evidence: "unadopted evidence",
    },
  ];
  s.shared.db
    .prepare("UPDATE refs SET data=? WHERE id=?")
    .run(
      JSON.stringify({
        ...ref,
        analysis: { referenceId: ref.id, findings },
        accepted: [0],
      }),
      ref.id,
    );
  taste(s);
  const a = create(s);
  const before = s.export(a.id, 1);
  expect(JSON.stringify(s.revision(a.id).snapshot)).toContain("old evidence");
  expect(JSON.stringify(s.revision(a.id).snapshot)).not.toContain(
    "unadopted recommendation",
  );
  s.shared.remove(ref.id, 1);
  taste(s);
  const d = s.diff(a.id);
  expect(d.changes.find((c) => c.key === `reference:${ref.id}`)?.kind).toBe(
    "削除",
  );
  s.adopt(
    a.id,
    1,
    s.taste().revision,
    Object.fromEntries(d.changes.map((c) => [c.key, "adopt"])),
  );
  expect(s.revision(a.id).snapshot.taste.references).toEqual([]);
  expect(s.export(a.id, 1)).toEqual(before);
});
it("retries a failure between browser project import and profile import without duplicating design", async () => {
  const s = setup(),
    raw = { ...initialState, answers: { "density-0": "a" } };
  const original = s.saveTaste;
  s.saveTaste = () => {
    throw new Error("simulated disk failure");
  };
  await expect(s.importBrowser(raw)).rejects.toThrow("simulated disk failure");
  const history = s.scope("legacy").foundation.history();
  expect(history).toHaveLength(2);
  expect(s.list()).toHaveLength(1);
  s.saveTaste = original;
  await s.importBrowser(raw);
  expect(s.scope("legacy").foundation.history()).toHaveLength(2);
  expect(s.taste().snapshot.answers["density-0"]).toBe("a");
});
