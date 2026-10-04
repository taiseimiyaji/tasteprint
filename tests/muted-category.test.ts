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

it("new portable exports use the corrected category token without replacing saved preview-2 downloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "category-export-"));
  const service = new ProjectService(directory);
  try {
    const project = service.create(
      briefSchema.parse({ name: "User colors" }),
      false,
    );
    const foundation = service.scope(project.id).foundation;
    const revision = foundation.save(
      1,
      { ...foundation.current()!.design, muted: "#123456" },
      "User color",
      randomUUID(),
    );
    const old = bundleFiles(service.revision(project.id));
    for (const name of Object.keys(old.files))
      old.files[name] = old.files[name].replaceAll(
        templateVersion,
        "preview-2",
      );
    old.files["ui/styles.css"] = old.files["ui/styles.css"].replace(
      /(\.sample-app td:first-child small \{[^}]*color: )[^;]+;/,
      "$1#a9b39b;",
    );
    const root = `tasteprint-${project.slug}-r${revision.revision}`;
    const completed = finishBundle(
      old.files,
      { ...old.metadata, templateVersion: "preview-2" },
      {},
      root,
    );
    const zipName = `${root}.zip`;
    const legacy = {
      projectId: project.id,
      revision: revision.revision,
      id: randomUUID(),
      createdAt: "2026-01-01T00:00:00Z",
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
      templateVersion: "preview-2",
      imageMode: "omit",
    };
    const raw = JSON.stringify(legacy);
    const db = service.scope(project.id).references.db;
    db.prepare("INSERT INTO exports VALUES (?,?)").run(legacy.id, raw);
    const current = await service.exportBundle(
      project.id,
      revision.revision,
      "omit",
    );
    expect(current.id).not.toBe(legacy.id);
    expect(current.templateVersion).not.toBe("preview-2");
    expect(current.templateVersion).toBe(templateVersion);
    const newZip = current.binaryFiles!.find((name) => name.endsWith(".zip"))!;
    const files = unzipSync(Buffer.from(current.files[newZip], "base64"));
    const css = Buffer.from(files[`${root}/ui/styles.css`]).toString();
    const block = css.match(
      /\.sample-app td:first-child small \{[^}]*color:[^}]*\}/,
    )![0];
    expect(block).toContain("color: var(--color-muted)");
    expect(block).not.toContain("#a9b39b");
    expect(Buffer.from(files[`${root}/ui/design.ts`]).toString()).toContain(
      '"muted": "#123456"',
    );
    expect(JSON.parse(current.files["manifest.json"]).templateVersion).toBe(
      templateVersion,
    );
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
    expect(service.revision(project.id).design).toEqual(revision.design);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
