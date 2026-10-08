import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Hono } from "hono";
import { ProjectService } from "../src/server/projects/service";
import { projectRoutes } from "../src/server/projects/routes";
import { initialState } from "../src/client/state";

const services: ProjectService[] = [],
  directories: string[] = [];
function open(directory: string) {
  const s = new ProjectService(directory, {
    generate: async () => {
      throw new Error("Real AI forbidden");
    },
  });
  services.push(s);
  return s;
}
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "tasteprint-legacy-answers-"));
  directories.push(directory);
  const s = open(directory);
  await s.importBrowser({ ...structuredClone(initialState), references: [] });
  return s;
}
async function restart(s: ProjectService) {
  services.splice(services.indexOf(s), 1);
  await s.close();
  return open(s.directory);
}
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const d of directories.splice(0))
    rmSync(d, { force: true, recursive: true });
});
const payload = (mixed = false) => ({
  ...structuredClone(initialState),
  answers: {
    "legacy-axis": "both" as const,
    ...(mixed ? { "density-0": "skip" as const } : {}),
  },
  references: [
    {
      id: "old-source",
      name: "Legacy source",
      url: "",
      aspects: ["Typography"],
    },
  ],
});
function rows(s: ProjectService) {
  const scope = s.scope("legacy");
  return {
    revisions: scope.references.db
      .prepare("SELECT * FROM foundation_revisions ORDER BY revision")
      .all(),
    refs: scope.references.db.prepare("SELECT * FROM refs ORDER BY id").all(),
    imports: scope.references.db
      .prepare("SELECT * FROM browser_imports ORDER BY id")
      .all(),
    tastes: s.db
      .prepare("SELECT * FROM taste_revisions ORDER BY revision")
      .all(),
    migrations: s.db.prepare("SELECT * FROM migrations ORDER BY id").all(),
  };
}
function backup(s: ProjectService, key: string) {
  return readFileSync(
    join(s.directory, "backup-before-projects", `${key}.json`),
    "utf8",
  );
}
for (const mixed of [false, true]) {
  it(`completes authenticated HTTP import with ${mixed ? "mixed current and unknown" : "only unknown"} answers, retaining the original data and durable replay`, async () => {
    let s = await setup();
    const raw = payload(mixed),
      before = rows(s),
      profileBefore = s.taste();
    const origin = "http://localhost:3000",
      app = new Hono().route("/api", projectRoutes(s, "fixture-pair", [3000]));
    const paired = await app.request(`${origin}/api/pair`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "fixture-pair" }),
    });
    const cookie = paired.headers.get("set-cookie")!.split(";")[0];
    const request = () =>
      app.request(`${origin}/api/migration/browser`, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(raw),
      });
    const response = await request();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.projectId).toBe("legacy");
    expect(s.revision("legacy").snapshot.taste.answers).toEqual(raw.answers);
    expect(backup(s, result.backup)).toBe(JSON.stringify(raw));
    const after = rows(s);
    expect(after.revisions.slice(0, before.revisions.length)).toEqual(
      before.revisions,
    );
    expect(after.imports).toHaveLength(before.imports.length + 1);
    expect(after.imports.find((row) => row.id === result.backup)?.data).toBe(
      JSON.stringify(raw),
    );
    expect(after.migrations).toHaveLength(before.migrations.length + 1);
    if (mixed) {
      expect(s.taste().snapshot.answers).toEqual({ "density-0": "skip" });
      expect(s.taste().snapshot.confirmed).toBe(true);
      expect(after.tastes.slice(0, before.tastes.length)).toEqual(
        before.tastes,
      );
    } else {
      expect(s.taste()).toEqual(profileBefore);
      expect(s.taste().snapshot.confirmed).toBe(false);
      expect(after.tastes).toEqual(before.tastes);
    }
    expect(await (await request()).json()).toEqual(result);
    expect(rows(s)).toEqual(after);
    s = await restart(s);
    expect(await s.importBrowser(raw)).toEqual(result);
    expect(rows(s)).toEqual(after);
    expect(backup(s, result.backup)).toBe(JSON.stringify(raw));
  });
}
it("keeps an already confirmed shared Taste and earlier Project revisions unchanged while retaining all legacy answers", async () => {
  const s = await setup(),
    scope = s.scope("legacy"),
    raw = payload(true);
  s.saveTaste(1, {
    answers: { "density-0": "a" },
    reasons: { "density-0": "Existing choice" },
    principles: [],
  });
  scope.foundation.save(
    s.revision("legacy").revision,
    { ...s.revision("legacy").design, radius: 13 },
    "Existing design",
    randomUUID(),
  );
  const before = rows(s),
    sharedBefore = s.taste(),
    designBefore = s.revision("legacy").design;
  const result = await s.importBrowser(raw);
  expect(s.taste()).toEqual(sharedBefore);
  expect(rows(s).tastes).toEqual(before.tastes);
  expect(rows(s).revisions.slice(0, before.revisions.length)).toEqual(
    before.revisions,
  );
  expect(s.revision("legacy").design).toEqual(designBefore);
  expect(s.revision("legacy").snapshot.taste.answers).toEqual(raw.answers);
  expect(backup(s, result.backup)).toBe(JSON.stringify(raw));
});
it.each(["taste_revisions", "migrations"])(
  "rolls back the shared transaction when %s INSERT fails and resumes the durable Project checkpoint after restart",
  async (table) => {
    let s = await setup();
    const raw = payload(true),
      before = rows(s);
    s.db.exec(
      `CREATE TRIGGER fail_migration BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected migration failure'); END`,
    );
    await expect(s.importBrowser(raw)).rejects.toThrow(
      "injected migration failure",
    );
    const checkpoint = rows(s);
    expect(checkpoint.revisions).toHaveLength(before.revisions.length + 1);
    expect(checkpoint.revisions.slice(0, before.revisions.length)).toEqual(
      before.revisions,
    );
    expect(checkpoint.refs).toHaveLength(1);
    expect(checkpoint.imports).toHaveLength(before.imports.length + 1);
    const imported = checkpoint.imports.find(
      (row) => row.data === JSON.stringify(raw),
    )!;
    expect(imported).toBeDefined();
    expect(checkpoint.tastes).toEqual(before.tastes);
    expect(checkpoint.migrations).toEqual(before.migrations);
    const key = String(imported.id);
    expect(backup(s, key)).toBe(JSON.stringify(raw));
    s = await restart(s);
    expect(rows(s)).toEqual(checkpoint);
    s.db.exec("DROP TRIGGER fail_migration");
    const result = await s.importBrowser(raw),
      after = rows(s);
    expect(after.revisions).toEqual(checkpoint.revisions);
    expect(after.refs).toEqual(checkpoint.refs);
    expect(after.imports).toEqual(checkpoint.imports);
    expect(after.tastes).toHaveLength(2);
    expect(after.migrations).toHaveLength(before.migrations.length + 1);
    expect(s.taste().snapshot.answers).toEqual({ "density-0": "skip" });
    expect(await s.importBrowser(raw)).toEqual(result);
    expect(rows(s)).toEqual(after);
  },
);
it("rolls back imported Reference and revision rows when the Project checkpoint fails, preserving the raw backup for retry", async () => {
  const s = await setup(),
    raw = payload(true),
    before = rows(s),
    scope = s.scope("legacy");
  scope.references.db.exec(
    "CREATE TRIGGER fail_import BEFORE INSERT ON browser_imports BEGIN SELECT RAISE(ABORT,'injected checkpoint failure'); END",
  );
  await expect(s.importBrowser(raw)).rejects.toThrow(
    "injected checkpoint failure",
  );
  expect(rows(s)).toEqual(before);
  const key =
    "browser-" + createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  expect(backup(s, key)).toBe(JSON.stringify(raw));
  scope.references.db.exec("DROP TRIGGER fail_import");
  const result = await s.importBrowser(raw);
  expect(backup(s, result.backup)).toBe(JSON.stringify(raw));
  expect(rows(s).revisions).toHaveLength(before.revisions.length + 1);
  expect(rows(s).refs).toHaveLength(1);
});
