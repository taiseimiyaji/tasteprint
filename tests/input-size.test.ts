import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import {
  bundleFiles,
  finishBundle,
  templateVersion,
} from "../src/server/exports/bundle";

it("portable Input size uses component height while old preview-5 ZIPs and revision rows remain unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "input-size-export-"));
  const service = new ProjectService(directory);
  try {
    const project = service.create(
      briefSchema.parse({ name: "Saved Input size" }),
      false,
    );
    const foundation = service.scope(project.id).foundation;
    const db = service.scope(project.id).references.db;
    const initialRaw = db
      .prepare("SELECT data FROM foundation_revisions WHERE revision=1")
      .get()!.data;
    const revision = foundation.save(
      1,
      {
        ...foundation.current()!.design,
        controlHeight: 80,
        components: {
          ...foundation.current()!.design.components,
          Input: {
            ...foundation.current()!.design.components.Input,
            size: "lg",
          },
        },
      },
      "User Input size",
      randomUUID(),
    );
    const savedRaw = db
      .prepare("SELECT data FROM foundation_revisions WHERE revision=?")
      .get(revision.revision)!.data;
    const old = bundleFiles(service.revision(project.id));
    for (const name of Object.keys(old.files))
      old.files[name] = old.files[name].replaceAll(
        templateVersion,
        "preview-5",
      );
    const rule =
      '.sample-app.runtime-root input[data-component="Input"] {\n  min-height: var(--component-height);\n}\n';
    expect(old.files["ui/styles.css"]).toContain(rule);
    old.files["ui/styles.css"] = old.files["ui/styles.css"].replace(rule, "");
    expect(old.files["ui/styles.css"]).not.toContain(
      '.sample-app.runtime-root input[data-component="Input"]',
    );
    const root = `tasteprint-${project.slug}-r${revision.revision}`;
    const completed = finishBundle(
      old.files,
      { ...old.metadata, templateVersion: "preview-5" },
      {},
      root,
    );
    const zipName = `${root}.zip`;
    const legacy = {
      id: randomUUID(),
      projectId: project.id,
      revision: revision.revision,
      createdAt: "2026-01-01T00:00:00Z",
      templateVersion: "preview-5",
      imageMode: "omit",
      files: {
        ...Object.fromEntries(
          Object.entries(completed.files).map(([name, value]) => [
            name.replaceAll("/", "--"),
            value,
          ]),
        ),
        [zipName]: completed.zip.toString("base64"),
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
    expect(current.templateVersion).not.toBe("preview-5");
    expect(current.templateVersion).toBe(templateVersion);
    const entries = unzipSync(Buffer.from(current.files[zipName], "base64"));
    const css = Buffer.from(entries[`${root}/ui/styles.css`]).toString();
    expect(css).toContain(rule);
    const library = Buffer.from(
      entries[`${root}/ui/design-runtime/Library.tsx`],
    ).toString();
    expect(library).toContain("baseHeight + { sm: -8, md: 0, lg: 8 }[c.size]");
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
        .prepare("SELECT data FROM foundation_revisions WHERE revision=1")
        .get()!.data,
    ).toBe(initialRaw);
    expect(
      db
        .prepare("SELECT data FROM foundation_revisions WHERE revision=?")
        .get(revision.revision)!.data,
    ).toBe(savedRaw);
    expect(service.revision(project.id).design).toEqual(revision.design);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
