import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import { defaultDesign, designSchema } from "../src/domain/design";
import { initialState } from "../src/client/state";
import { ReferenceService } from "../src/server/references/service";
import { FoundationService } from "../src/server/foundation/service";
const dirs: string[] = [],
  services: ProjectService[] = [];
function open(directory = mkdtempSync(join(tmpdir(), "new-project-color-"))) {
  if (!dirs.includes(directory)) dirs.push(directory);
  const service = new ProjectService(directory);
  services.push(service);
  return service;
}
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of dirs.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
it("new projects use the candidate only in initial r1 and export their actual design", async () => {
  const service = open();
  const profile = service.saveTaste(service.taste().revision, {
    answers: { "density-0": "a" },
    reasons: { "density-0": "More space" },
    principles: [
      {
        id: "readable",
        target: "list",
        text: "Readable rows",
        reason: "Scanning",
        sources: [],
        locked: false,
      },
    ],
  });
  for (const useTaste of [false, true]) {
    const project = service.create(
      briefSchema.parse({ name: "New color" }),
      useTaste,
      service.taste().revision,
    );
    const revision = service.revision(project.id);
    expect(revision.revision).toBe(1);
    expect(revision.design).toEqual({ ...defaultDesign, muted: "#6c7164" });
    expect(revision.snapshot.sourceTasteProfileRevision).toBe(
      useTaste ? service.taste().revision : null,
    );
    expect(revision.dna).toEqual(revision.snapshot.taste.dna);
    expect(revision.snapshot.taste.answers).toEqual(
      useTaste ? profile.snapshot.answers : {},
    );
    expect(revision.snapshot.taste.principles).toEqual(
      useTaste ? profile.snapshot.principles : [],
    );
    expect(service.scope(project.id).foundation.history()).toHaveLength(1);
    const exported = service.export(project.id, 1);
    const jsonName = Object.keys(exported.files).find((name) =>
      name.endsWith("-design-system.json"),
    )!;
    expect(JSON.parse(exported.files[jsonName]).design).toEqual(
      revision.design,
    );
  }
  expect(defaultDesign.muted).toBe("#878b80");
  const { muted: _ignored, ...old } = defaultDesign;
  expect(designSchema.parse(old).muted).toBe("#878b80");
});
it.each(["#878b80", "#123456", undefined])(
  "existing explicit or legacy color %s stays unchanged through read, save and restore",
  async (muted) => {
    let service = open();
    const directory = service.directory;
    const project = service.create(
      briefSchema.parse({ name: "Existing" }),
      false,
    );
    const original = service.revision(project.id);
    const design: Record<string, unknown> = { ...defaultDesign };
    if (muted === undefined) delete design.muted;
    else design.muted = muted;
    const raw = JSON.stringify({ ...original, design });
    service
      .scope(project.id)
      .references.db.prepare(
        "UPDATE foundation_revisions SET data=? WHERE revision=1",
      )
      .run(raw);
    await service.close();
    services.splice(services.indexOf(service), 1);
    service = open(directory);
    const foundation = service.scope(project.id).foundation;
    const expected = muted ?? "#878b80";
    expect(service.revision(project.id).design.muted).toBe(expected);
    expect(foundation.initialize().design.muted).toBe(expected);
    service.create(briefSchema.parse({ name: "Unrelated new" }), false);
    const edited = foundation.save(
      1,
      { ...foundation.current()!.design, radius: 9 },
      "Other field",
      randomUUID(),
    );
    expect(edited.design.muted).toBe(expected);
    expect(foundation.restore(2, 1, randomUUID()).design.muted).toBe(expected);
    expect(
      service
        .scope(project.id)
        .references.db.prepare(
          "SELECT data FROM foundation_revisions WHERE revision=1",
        )
        .get()!.data,
    ).toBe(raw);
  },
);
it("browser-only legacy import preserves its original color and remains idempotent", async () => {
  const service = open();
  const raw = {
    ...initialState,
    design: { ...defaultDesign, muted: "#123456", radius: 17 },
    references: [],
  };
  const imported = await service.importBrowser(raw);
  expect(service.revision(imported.projectId).design).toEqual(raw.design);
  const count = service.scope(imported.projectId).foundation.history().length;
  await service.importBrowser(raw);
  expect(service.scope(imported.projectId).foundation.history()).toHaveLength(
    count,
  );
  service.create(briefSchema.parse({ name: "New after legacy" }), false);
  expect(service.revision(imported.projectId).design).toEqual(raw.design);
});
it("SQLite legacy migration retains custom colors and original revision bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "legacy-color-"));
  dirs.push(directory);
  const old = new ReferenceService(directory);
  const foundation = new FoundationService(old.db);
  foundation.initialize({ ...defaultDesign, muted: "#123456" });
  const original = old.db
    .prepare("SELECT revision,data FROM foundation_revisions ORDER BY revision")
    .all();
  await old.close();
  const service = open(directory);
  expect(service.revision("legacy").design.muted).toBe("#123456");
  const db = service.scope("legacy").references.db;
  expect(
    db
      .prepare(
        "SELECT revision,data FROM foundation_revisions ORDER BY revision",
      )
      .all(),
  ).toEqual(original);
  service.create(briefSchema.parse({ name: "New alongside legacy" }), false);
  expect(service.revision("legacy").design.muted).toBe("#123456");
  expect(
    db
      .prepare(
        "SELECT revision,data FROM foundation_revisions ORDER BY revision",
      )
      .all(),
  ).toEqual(original);
});
