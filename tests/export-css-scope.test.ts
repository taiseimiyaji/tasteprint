import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { scopedExportCss } from "../src/server/exports/scoped-css";
import { ProjectService } from "../src/server/projects/service";
import { templateVersion } from "../src/server/exports/bundle";
import { briefSchema } from "../src/domain/projects";

it("localizes root, compound selectors, pseudo-elements and media without scoping keyframe steps", () => {
  const css =
    scopedExportCss(`@import "font.css"; :root{--ink:red} body{margin:0} .sample-app{display:flex}
    .runtime-root dialog::backdrop{background:black} input:not([type="checkbox"]){color:red}
    @media(prefers-reduced-motion:reduce){*{animation:none!important}}
    @keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`);
  expect(css).toContain('@import "font.css"');
  expect(css).not.toContain(":root");
  expect(css).toContain(":where(.tasteprint-runtime){--ink:red}");
  expect(css).toContain(".sample-app:where(.tasteprint-runtime)");
  expect(css).toContain(":where(.tasteprint-runtime) .sample-app");
  expect(css).toContain(
    ".runtime-root:where(.tasteprint-runtime) dialog::backdrop",
  );
  expect(css).toContain(
    'input:not([type="checkbox"]):where(.tasteprint-runtime)',
  );
  expect(css).toContain(
    "*:where(.tasteprint-runtime),:where(.tasteprint-runtime) *",
  );
  expect(css).toContain("@keyframes tasteprint-export-spin{to{");
  expect(css).toContain("animation:tasteprint-export-spin 1s linear infinite");
});

it.each([
  [
    "preview-9",
    "e3fcc90ebe948265d5098d7661eeee34a2954a57fb84ddbe94218427b70c3e48",
  ],
  [
    "preview-10",
    "8dfd2af44c0f1e1e55e6cac443b97856df3bf08ff6d24156a9d9d0fc22119a78",
  ],
])(
  "preserves the actual stored %s archive and revision while generating and reusing preview-11",
  async (version, digest) => {
    const bytes = readFileSync(
      new URL(`./fixtures/${version}.zip`, import.meta.url),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
    const directory = mkdtempSync(join(tmpdir(), "export-scope-frozen-"));
    const service = new ProjectService(directory);
    try {
      const project = service.create(
        briefSchema.parse({ name: "Frozen archive preservation" }),
        false,
      );
      const revision = service.revision(project.id);
      const db = service.scope(project.id).references.db;
      const rows = db
        .prepare(
          "SELECT revision,data FROM foundation_revisions ORDER BY revision",
        )
        .all();
      const old = {
        id: randomUUID(),
        projectId: project.id,
        revision: 1,
        templateVersion: version,
        imageMode: "omit",
        createdAt: "2026-10-06T00:00:00Z",
        files: { [`frozen-${version}.zip`]: bytes.toString("base64") },
        binaryFiles: [`frozen-${version}.zip`],
      };
      const raw = JSON.stringify(old);
      db.prepare("INSERT INTO exports VALUES (?,?)").run(old.id, raw);
      const next = await service.exportBundle(project.id, 1, "omit");
      expect(next.id).not.toBe(old.id);
      expect(next.templateVersion).toBe(templateVersion);
      expect(templateVersion).toBe("preview-11");
      expect(next.files["ui--styles.css"]).toContain(
        ":where(.tasteprint-runtime)",
      );
      expect(next.files["tokens--variables.css"]).not.toContain(":root");
      expect(JSON.parse(next.files["manifest.json"]).templateVersion).toBe(
        "preview-11",
      );
      const zipName = next.binaryFiles!.find((name) => name.endsWith(".zip"))!;
      const entries = unzipSync(Buffer.from(next.files[zipName], "base64"));
      expect(
        Object.keys(entries).some((name) => name.endsWith("/ui/styles.css")),
      ).toBe(true);
      expect((await service.exportBundle(project.id, 1, "omit")).id).toBe(
        next.id,
      );
      expect(service.exports(project.id)).toHaveLength(2);
      expect(
        db.prepare("SELECT data FROM exports WHERE id=?").get(old.id)!.data,
      ).toBe(raw);
      expect(
        Buffer.from(
          service.exports(project.id).find((record) => record.id === old.id)!
            .files[`frozen-${version}.zip`],
          "base64",
        ),
      ).toEqual(bytes);
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
  },
);
