import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import { templateVersion } from "../src/server/exports/bundle";

it("retains a frozen preview-14 export while generating and reusing the corrected template", async () => {
  const directory = mkdtempSync(join(tmpdir(), "export-pending-edit-"));
  const service = new ProjectService(directory);
  try {
    const project = service.create(
      briefSchema.parse({ name: "Pending edit export" }),
      false,
    );
    const db = service.scope(project.id).references.db;
    const old = {
      id: randomUUID(),
      projectId: project.id,
      revision: 1,
      templateVersion: "preview-14",
      imageMode: "omit",
      createdAt: "2026-10-28T00:00:00Z",
      files: {
        "old-r1.zip": Buffer.from(
          zipSync({ "old.txt": Buffer.from("frozen archive") }),
        ).toString("base64"),
      },
      binaryFiles: ["old-r1.zip"],
    };
    const raw = JSON.stringify(old);
    db.prepare("INSERT INTO exports VALUES (?,?)").run(old.id, raw);

    const current = await service.exportBundle(project.id, 1, "omit");
    expect(templateVersion).toBe("preview-15");
    expect(current.id).not.toBe(old.id);
    expect(current.templateVersion).toBe(templateVersion);
    const zipName = current.binaryFiles!.find((name) => name.endsWith(".zip"))!;
    const root = `tasteprint-${project.slug}-r1`;
    const entries = unzipSync(Buffer.from(current.files[zipName], "base64"));
    expect(
      Buffer.from(entries[`${root}/ui/components/Preview.tsx`]).toString(),
    ).toBe(
      readFileSync(
        resolve("src/client/components/Preview.tsx"),
        "utf8",
      ).replaceAll('"../../domain/', '"../domain/'),
    );
    expect(
      JSON.parse(Buffer.from(entries[`${root}/manifest.json`]).toString())
        .templateVersion,
    ).toBe(templateVersion);
    expect((await service.exportBundle(project.id, 1, "omit")).id).toBe(
      current.id,
    );
    expect(service.exports(project.id)).toHaveLength(2);
    expect(
      db.prepare("SELECT data FROM exports WHERE id=?").get(old.id)!.data,
    ).toBe(raw);
    expect(
      Buffer.from(
        unzipSync(
          Buffer.from(
            service.exports(project.id).find((record) => record.id === old.id)!
              .files["old-r1.zip"],
            "base64",
          ),
        )["old.txt"],
      ).toString(),
    ).toBe("frozen archive");
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
