import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProjectService,
  type Dependencies,
} from "../src/server/projects/service";
import { ReferenceService } from "../src/server/references/service";
import { installArchiveVersionSchema } from "../src/server/projects/archive-schema";
import { briefSchema } from "../src/domain/projects";

const dirs: string[] = [];
const services: ProjectService[] = [];
const failed: DatabaseSync[] = [];
const dependencies: Dependencies = {
  referenceFactory: (dir) =>
    new ReferenceService(
      dir,
      async () => {
        throw new Error("unexpected capture");
      },
      async () => {
        throw new Error("unexpected AI");
      },
    ),
  generate: async () => {
    throw new Error("unexpected AI");
  },
  reviewAI: async () => {
    throw new Error("unexpected AI");
  },
};
function records(dir: string, id: string) {
  const workspace = new DatabaseSync(join(dir, "workspace.sqlite"), {
    readOnly: true,
  });
  const scope = new DatabaseSync(
    join(dir, "projects", id, "references.sqlite"),
    { readOnly: true },
  );
  try {
    return {
      projects: workspace
        .prepare(
          "SELECT id,slug,created_at,archived_at FROM projects ORDER BY id",
        )
        .all(),
      foundation: scope
        .prepare(
          "SELECT revision,data FROM foundation_revisions ORDER BY revision",
        )
        .all(),
      exports: scope
        .prepare("SELECT rowid,id,data FROM exports ORDER BY rowid")
        .all(),
    };
  } finally {
    workspace.close();
    scope.close();
  }
}
function objects(dir: string) {
  const db = new DatabaseSync(join(dir, "workspace.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        "SELECT type,name FROM sqlite_master WHERE name IN ('project_archive_versions','projects_archive_version') ORDER BY name",
      )
      .all();
  } finally {
    db.close();
  }
}
async function legacy() {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-archive-schema-"));
  dirs.push(dir);
  const service = new ProjectService(dir, dependencies);
  const project = service.create(
    briefSchema.parse({ name: "Preserved schema fixture" }),
    false,
    service.taste().revision,
  );
  service.export(project.id, 1);
  const bundle = await service.exportBundle(project.id, 1, "omit");
  expect(bundle.binaryFiles?.some((name) => name.endsWith(".zip"))).toBe(true);
  service.archive(project.id, 1, true);
  await service.close();
  const db = new DatabaseSync(join(dir, "workspace.sqlite"));
  db.exec(
    "DROP TRIGGER projects_archive_version; DROP TABLE project_archive_versions",
  );
  db.close();
  return { dir, project, before: records(dir, project.id) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) await service.close();
  for (const db of failed.splice(0)) {
    try {
      db.close();
    } catch {}
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

for (const fault of ["trigger", "before-commit"] as const)
  it(`rolls back ${fault} install failure, closes the connection and preserves original data on restart`, async () => {
    const fixture = await legacy();
    const original = DatabaseSync.prototype.exec;
    let connection: DatabaseSync | undefined;
    let originalError: unknown;
    const interruption = new Error("interrupted before commit");
    const spy = vi
      .spyOn(DatabaseSync.prototype, "exec")
      .mockImplementation(function (this: DatabaseSync, sql: string) {
        if (
          sql.includes("CREATE TRIGGER IF NOT EXISTS projects_archive_version")
        ) {
          connection = this;
          failed.push(this);
          if (fault === "trigger") {
            try {
              return original.call(
                this,
                sql.replace(
                  "CREATE TRIGGER IF NOT EXISTS projects_archive_version",
                  "CREATE TRIGGER BROKEN projects_archive_version",
                ),
              );
            } catch (error) {
              originalError = error;
              throw error;
            }
          }
        }
        if (
          fault === "before-commit" &&
          this === connection &&
          sql === "COMMIT"
        ) {
          originalError = interruption;
          throw interruption;
        }
        return original.call(this, sql);
      });
    let error: unknown;
    try {
      services.push(new ProjectService(fixture.dir, dependencies));
    } catch (caught) {
      error = caught;
    }
    spy.mockRestore();
    expect(error).toBe(originalError);
    expect(error).toBeDefined();
    expect(() => connection!.prepare("SELECT 1")).toThrow();
    expect(objects(fixture.dir)).toEqual([]);
    expect(records(fixture.dir, fixture.project.id)).toEqual(fixture.before);
    const restarted = new ProjectService(fixture.dir, dependencies);
    services.push(restarted);
    expect(objects(fixture.dir)).toHaveLength(2);
    expect(restarted.project(fixture.project.id).archiveVersion).toBe(0);
    expect(records(fixture.dir, fixture.project.id)).toEqual(fixture.before);
  });

it("retains the original installation error when rollback and close cleanup also report errors", async () => {
  const fixture = await legacy();
  const originalExec = DatabaseSync.prototype.exec,
    originalClose = DatabaseSync.prototype.close;
  let connection: DatabaseSync | undefined, originalError: unknown;
  const cleanup = new Error("cleanup reported an error");
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (sql.includes("CREATE TRIGGER IF NOT EXISTS projects_archive_version")) {
      connection = this;
      failed.push(this);
      try {
        return originalExec.call(
          this,
          sql.replace(
            "CREATE TRIGGER IF NOT EXISTS projects_archive_version",
            "CREATE TRIGGER BROKEN projects_archive_version",
          ),
        );
      } catch (error) {
        originalError = error;
        throw error;
      }
    }
    if (this === connection && sql === "ROLLBACK") throw cleanup;
    return originalExec.call(this, sql);
  });
  vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function (
    this: DatabaseSync,
  ) {
    originalClose.call(this);
    if (this === connection) throw cleanup;
  });
  let error: unknown;
  try {
    services.push(new ProjectService(fixture.dir, dependencies));
  } catch (caught) {
    error = caught;
  }
  vi.restoreAllMocks();
  expect(error).toBe(originalError);
  expect(error).not.toBe(cleanup);
  expect(() => connection!.prepare("SELECT 1")).toThrow();
  expect(objects(fixture.dir)).toEqual([]);
  expect(records(fixture.dir, fixture.project.id)).toEqual(fixture.before);
});

it("keeps successful install, restart and repeated setup idempotent without resetting version or frozen exports", async () => {
  const fixture = await legacy();
  const first = new ProjectService(fixture.dir, dependencies);
  expect(records(fixture.dir, fixture.project.id)).toEqual(fixture.before);
  expect(first.archive(fixture.project.id, 1, false).archiveVersion).toBe(1);
  const after = records(fixture.dir, fixture.project.id);
  await first.close();
  const restarted = new ProjectService(fixture.dir, dependencies);
  services.push(restarted);
  installArchiveVersionSchema(restarted.db);
  installArchiveVersionSchema(restarted.db);
  expect(restarted.project(fixture.project.id).archiveVersion).toBe(1);
  expect(objects(fixture.dir)).toHaveLength(2);
  expect(records(fixture.dir, fixture.project.id)).toEqual(after);
  expect(after.foundation).toEqual(fixture.before.foundation);
  expect(after.exports).toEqual(fixture.before.exports);
});
