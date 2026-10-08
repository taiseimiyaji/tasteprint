import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import {
  bundleFiles,
  finishBundle,
  templateVersion,
} from "../src/server/exports/bundle";

async function verifyFrozen(frozenVersion: string) {
  const directory = mkdtempSync(join(tmpdir(), "widget-identity-export-"));
  const service = new ProjectService(directory);
  try {
    const project = service.create(
      briefSchema.parse({ name: "Reused widgets" }),
      false,
    );
    const revision = service.revision(project.id);
    const db = service.scope(project.id).references.db;
    const rows = db
      .prepare(
        "SELECT revision,data FROM foundation_revisions ORDER BY revision",
      )
      .all();
    const old = bundleFiles(revision);
    for (const name of Object.keys(old.files))
      old.files[name] = old.files[name].replaceAll(
        templateVersion,
        frozenVersion,
      );
    // A frozen renderer fixture reproducing the old fixed ARIA IDs. The raw
    // archive is the preservation contract, independent of runtime internals.
    const path = "ui/design-runtime/Library.tsx";
    if (frozenVersion === "preview-6") {
      old.files[path] = old.files[path]
        .replace("aria-labelledby={titleId}", 'aria-labelledby="dialog-title"')
        .replace("id={titleId}", 'id="dialog-title"')
        .replace("id={`${id}-tab-${i}`}", "id={`tab-${i}`}")
        .replace(
          "aria-controls={`${id}-panel`}",
          'aria-controls="project-panel"',
        )
        .replace("id={`${id}-panel`}", 'id="project-panel"')
        .replace(
          "aria-labelledby={`${id}-tab-${active}`}",
          "aria-labelledby={`tab-${active}`}",
        );
      expect(old.files[path]).toContain('aria-controls="project-panel"');
    } else if (frozenVersion === "preview-7") {
      old.files[path] = old.files[path].replaceAll('type="button"', "");
      expect(old.files[path]).not.toContain('type="button"');
    } else if (frozenVersion === "preview-11") {
      old.files[path] = old.files[path].replace(
        /\.filter\(\s*\(el\) =>\s*el\.tabIndex >= 0 &&\s*!el\.matches\(":disabled"\) &&\s*el\.getClientRects\(\)\.length,?\s*\);/,
        ".filter((el) => el.getClientRects().length);",
      );
      expect(old.files[path]).not.toContain("el.tabIndex >= 0");
      expect(old.files[path]).toContain(
        ".filter((el) => el.getClientRects().length)",
      );
    } else {
      old.files[path] = old.files[path]
        .replace(/onClose=\{\(e\) => \{[\s\S]*?\}\}/, "onClose={close}")
        .replace(/onCancel=\{\(e\) => \{[\s\S]*?\}\}/, "onCancel={close}");
      expect(old.files[path]).toContain("onClose={close}");
      expect(old.files[path]).toContain("onCancel={close}");
    }
    const root = `tasteprint-${project.slug}-r${revision.revision}`;
    const frozen = finishBundle(
      old.files,
      { ...old.metadata, templateVersion: frozenVersion },
      {},
      root,
    );
    const zipName = `${root}.zip`;
    const legacy = {
      id: randomUUID(),
      projectId: project.id,
      revision: revision.revision,
      createdAt: "2026-01-01T00:00:00Z",
      templateVersion: frozenVersion,
      imageMode: "omit",
      files: {
        ...Object.fromEntries(
          Object.entries(frozen.files).map(([name, value]) => [
            name.replaceAll("/", "--"),
            value,
          ]),
        ),
        [zipName]: frozen.zip.toString("base64"),
      },
      binaryFiles: [zipName],
    };
    const raw = JSON.stringify(legacy);
    db.prepare("INSERT INTO exports VALUES (?,?)").run(legacy.id, raw);
    const current = await service.exportBundle(
      project.id,
      revision.revision,
      "omit",
    );
    expect(current.id).not.toBe(legacy.id);
    expect(current.templateVersion).toBe(templateVersion);
    expect(current.templateVersion).not.toBe(frozenVersion);
    const entries = unzipSync(Buffer.from(current.files[zipName], "base64"));
    expect(Buffer.from(entries[`${root}/${path}`]).toString()).toBe(
      readFileSync(
        resolve("src/client/design-runtime/Library.tsx"),
        "utf8",
      ).replaceAll('"../../domain/', '"../domain/'),
    );
    expect(
      JSON.parse(Buffer.from(entries[`${root}/design-system.json`]).toString())
        .design,
    ).toEqual(revision.design);
    expect(
      JSON.parse(Buffer.from(entries[`${root}/manifest.json`]).toString())
        .templateVersion,
    ).toBe(templateVersion);
    expect(
      (await service.exportBundle(project.id, revision.revision, "omit")).id,
    ).toBe(current.id);
    expect(service.exports(project.id)).toHaveLength(2);
    expect(
      db.prepare("SELECT data FROM exports WHERE id=?").get(legacy.id)!.data,
    ).toBe(raw);
    expect(
      service.exports(project.id).find((record) => record.id === legacy.id)!
        .files[zipName],
    ).toBe(legacy.files[zipName]);
    expect(
      db
        .prepare(
          "SELECT revision,data FROM foundation_revisions ORDER BY revision",
        )
        .all(),
    ).toEqual(rows);
    expect(service.revision(project.id)).toEqual(revision);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const frozenVersion of [
  "preview-6",
  "preview-7",
  "preview-8",
  "preview-11",
])
  it(`new portable widget source preserves frozen ${frozenVersion} ZIP and revision`, () =>
    verifyFrozen(frozenVersion));
