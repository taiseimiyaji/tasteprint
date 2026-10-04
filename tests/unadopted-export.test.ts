import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import { initialState, stateSchema } from "../src/client/state";
import { bundleFiles, templateVersion } from "../src/server/exports/bundle";

const finding = {
  aspect: "Colors",
  recommendation: "Use the adopted color hierarchy",
  interpretation: "Keep information readable",
  evidence: "Visible hierarchy",
};
const adopted = {
  name: "Adopted source",
  url: "https://fixture-user:fixture-password@example.com/page?fixture=private#fragment",
  accepted: [0],
  analysis: { findings: [finding] },
};
const unused = {
  name: "UNADOPTED_NAME",
  url: "relative/UNADOPTED_URL",
  accepted: [],
  analysis: { findings: [{ ...finding, evidence: "UNADOPTED_ANALYSIS" }] },
};

for (const family of ["project", "profile"] as const) {
  it(`${family} projection omits unused legacy URLs while preserving adopted evidence and identical successful output`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "unused-export-"));
    const service = new ProjectService(dir);
    try {
      const project = service.create(
        briefSchema.parse({ name: "Projection" }),
        false,
      );
      const revision = service.revision(project.id);
      const target =
        family === "project" ? revision.snapshot : revision.snapshot.taste;
      target.references = [adopted];
      const expected = bundleFiles(revision);
      target.references.push({ ...unused, url: "https://example.com/unused" });
      expect(bundleFiles(revision)).toEqual(expected);
      target.references[1] = unused;
      const projected = bundleFiles(revision);
      expect(projected).toEqual(expected);
      expect(projected.metadata.templateVersion).toBe(templateVersion);
      const content = JSON.parse(projected.files["design-system.json"]);
      expect(content.references).toEqual([
        {
          name: adopted.name,
          url: "https://example.com/page",
          principles: [finding],
        },
      ]);
      expect(JSON.stringify(projected.files)).not.toMatch(
        /UNADOPTED_|fixture-user|fixture-password|fixture=private|#fragment/,
      );

      target.references = [{ ...unused, url: 123 }];
      expect(() => bundleFiles(revision)).toThrow();
      target.references = [
        { ...unused, analysis: { findings: [{ ...finding, evidence: null }] } },
      ];
      expect(() => bundleFiles(revision)).toThrow();
      target.references = [{ ...adopted, url: "relative/adopted" }];
      expect(() => bundleFiles(revision)).toThrow("Invalid URL");
      target.references = [{ ...adopted, accepted: [9] }];
      expect(() => bundleFiles(revision)).toThrow("採用した参考分析");
    } finally {
      await service.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

it("supported browser import exports omit/include ZIPs without altering original sources, backups or revisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unused-legacy-export-"));
  const captured: { design: unknown; screen: string }[] = [];
  const png = await sharp({
    create: { width: 10, height: 10, channels: 4, background: "white" },
  })
    .png()
    .toBuffer();
  const service = new ProjectService(dir, {
    exportCapture: async (design, screen) => {
      captured.push({ design, screen });
      return { image: png, findings: [], verifiedRules: [], scope: [] };
    },
  });
  try {
    const raw = {
      ...initialState,
      references: [
        {
          id: "unused-legacy",
          name: unused.name,
          url: unused.url,
          aspects: ["Colors"],
        },
      ],
    };
    expect(stateSchema.safeParse(raw).success).toBe(true);
    const imported = await service.importBrowser(raw);
    const scope = service.scope(imported.projectId);
    const revision = service.revision(imported.projectId);
    const original = {
      refs: scope.references.db
        .prepare("SELECT data FROM refs ORDER BY rowid")
        .all(),
      revisions: scope.references.db
        .prepare(
          "SELECT revision, data FROM foundation_revisions ORDER BY revision",
        )
        .all(),
      import: scope.references.db
        .prepare("SELECT data FROM browser_imports WHERE id=?")
        .get(imported.backup),
      backup: readFileSync(
        join(dir, "backup-before-projects", `${imported.backup}.json`),
        "utf8",
      ),
    };
    expect(JSON.parse(original.backup)).toEqual(raw);
    const omitted = await service.exportBundle(
      imported.projectId,
      revision.revision,
      "omit",
    );
    const included = await service.exportBundle(
      imported.projectId,
      revision.revision,
      "include",
    );
    for (const record of [omitted, included]) {
      const zipName = record.binaryFiles!.find((name) =>
        name.endsWith(".zip"),
      )!;
      const entries = unzipSync(Buffer.from(record.files[zipName], "base64"));
      const text = Object.values(entries)
        .map((bytes) => Buffer.from(bytes).toString())
        .join("\n");
      expect(text).not.toMatch(/UNADOPTED_/);
      const jsonEntry = Object.keys(entries).find((name) =>
        name.endsWith("/design-system.json"),
      )!;
      const design = JSON.parse(Buffer.from(entries[jsonEntry]).toString());
      expect(design.references).toEqual([]);
      expect(design.design).toEqual(revision.design);
      expect(design.revision).toBe(revision.revision);
      const manifestEntry = Object.keys(entries).find((name) =>
        name.endsWith("/manifest.json"),
      )!;
      expect(
        JSON.parse(Buffer.from(entries[manifestEntry]).toString()).images,
      ).toBe(record.imageMode === "omit" ? "omitted" : "complete");
      expect(
        Object.keys(entries).filter((name) => name.endsWith(".png")),
      ).toHaveLength(record.imageMode === "omit" ? 0 : 3);
      expect(
        (
          await service.exportBundle(
            imported.projectId,
            revision.revision,
            record.imageMode,
          )
        ).id,
      ).toBe(record.id);
    }
    expect(captured).toEqual(
      ["list", "settings", "form"].map((screen) => ({
        design: revision.design,
        screen,
      })),
    );
    expect(service.exports(imported.projectId)).toHaveLength(2);
    expect(service.revision(imported.projectId)).toEqual(revision);
    expect(
      scope.references.db.prepare("SELECT data FROM refs ORDER BY rowid").all(),
    ).toEqual(original.refs);
    expect(
      scope.references.db
        .prepare(
          "SELECT revision, data FROM foundation_revisions ORDER BY revision",
        )
        .all(),
    ).toEqual(original.revisions);
    expect(
      scope.references.db
        .prepare("SELECT data FROM browser_imports WHERE id=?")
        .get(imported.backup),
    ).toEqual(original.import);
    expect(
      readFileSync(
        join(dir, "backup-before-projects", `${imported.backup}.json`),
        "utf8",
      ),
    ).toBe(original.backup);
    expect(await service.importBrowser(raw)).toEqual(imported);
    const input = {
      name: "New source",
      url: unused.url,
      likes: "",
      dislikes: "",
      selections: [{ aspect: "Colors" as const, intent: "reference" as const }],
    };
    expect(() => scope.references.create(input)).toThrow();
    const ref = scope.references.references()[0];
    expect(() => scope.references.update(ref.id, ref.version, input)).toThrow();
    expect(scope.references.reference(ref.id)).toEqual(ref);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
