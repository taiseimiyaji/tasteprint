import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { ProjectService } from "../src/server/projects/service";
import { projectRoutes } from "../src/server/projects/routes";
import { briefSchema } from "../src/domain/projects";
import { ServiceError } from "../src/server/references/service";

const fixtures: { service: ProjectService; dir: string }[] = [];
afterEach(async () => {
  for (const { service, dir } of fixtures.splice(0)) {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
function setup(replacements = 1) {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-taste-limit-"));
  const service = new ProjectService(dir);
  fixtures.push({ service, dir });
  const principles = Array.from({ length: 100 }, (_, i) => ({
    id: `limit-${i}`,
    target: "density",
    text: `原則 ${i}`,
    reason: "比較",
    sources: ["明示的な入力"],
    locked: false,
  }));
  const first = service.saveTaste(service.taste().revision, {
    answers: { "density-0": "a" },
    reasons: {},
    principles,
  });
  const project = service.create(
    briefSchema.parse({ name: "Bounded adoption" }),
    true,
    first.revision,
  );
  const latest = service.saveTaste(first.revision, {
    ...first.snapshot,
    principles: [
      ...principles.slice(replacements),
      ...principles
        .slice(0, replacements)
        .map((p, i) => ({ ...p, id: `new-${i}` })),
    ],
  });
  const rows = () =>
    service
      .scope(project.id)
      .references.db.prepare(
        "SELECT revision,data FROM foundation_revisions ORDER BY revision",
      )
      .all();
  return { service, project, first, latest, rows };
}
for (const count of [1, 2]) {
  it(`rejects a legal merge yielding ${100 + count} principles before any revision write, then permits exactly 100`, async () => {
    const f = setup(count),
      before = f.rows();
    const choices = Object.fromEntries(
      f.service
        .diff(f.project.id)
        .changes.map((c) => [
          c.key,
          c.key.startsWith("principle:new-") ? "adopt" : "keep",
        ]),
    ) as Record<string, "adopt" | "keep">;
    try {
      f.service.adopt(f.project.id, 1, f.latest.revision, choices);
      throw new Error("unexpected success");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ status: 400 });
      expect((error as Error).message).toContain("取り込み後の原則は100件まで");
    }
    expect(f.rows()).toEqual(before);
    expect(
      f.service.revision(f.project.id).snapshot.sourceTasteProfileRevision,
    ).toBe(f.first.revision);
    expect(f.service.taste()).toEqual(f.latest);
    for (const key of Object.keys(choices)) choices[key] = "adopt";
    const saved = f.service.adopt(f.project.id, 1, f.latest.revision, choices);
    expect(saved.revision).toBe(2);
    expect(saved.snapshot!.taste.principles).toEqual(
      f.latest.snapshot.principles,
    );
    expect(saved.snapshot!.taste.principles).toHaveLength(100);
    expect(saved.snapshot!.sourceTasteProfileRevision).toBe(f.latest.revision);
    expect(f.rows()[0]).toEqual(before[0]);
    const exported = await f.service.exportBundle(f.project.id, 2, "omit");
    expect(
      Object.keys(exported.files).some((path) => path.endsWith(".zip")),
    ).toBe(true);
    await expect(
      f.service.exportBundle(f.project.id, 2, "omit"),
    ).resolves.toEqual(exported);
  });
}
it("returns a clear HTTP 400 without a saved revision and accepts an explicit keep-only retry", async () => {
  const f = setup(),
    before = f.rows();
  const app = new Hono().route(
    "/api",
    projectRoutes(f.service, "pair", [3000]),
  );
  const origin = "http://localhost:3000";
  const paired = await app.request(`${origin}/api/pair`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "pair" }),
  });
  const cookie = paired.headers.get("set-cookie")!.split(";")[0];
  const adopt = (choices: Record<string, "adopt" | "keep">) =>
    app.request(`${origin}/api/projects/${f.project.id}/taste-diff`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        baseRevision: 1,
        baseProfileRevision: f.latest.revision,
        choices,
      }),
    });
  const rejected = await adopt({
    "principle:limit-0": "keep",
    "principle:new-0": "adopt",
  });
  expect(rejected.status).toBe(400);
  expect((await rejected.json()).message).toContain(
    "取り込み・維持の選択を見直してください",
  );
  expect(f.rows()).toEqual(before);
  expect(f.service.exportSummaries(f.project.id)).toEqual([]);
  const accepted = await adopt({
    "principle:limit-0": "keep",
    "principle:new-0": "keep",
  });
  expect(accepted.status).toBe(200);
  const saved = await accepted.json();
  expect(saved.revision).toBe(2);
  expect(saved.snapshot.taste.principles).toEqual(f.first.snapshot.principles);
  expect(saved.snapshot.maintained.map((m: { key: string }) => m.key)).toEqual([
    "principle:limit-0",
    "principle:new-0",
  ]);
  expect(f.rows()[0]).toEqual(before[0]);
});
