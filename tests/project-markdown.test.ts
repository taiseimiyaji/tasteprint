import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import { projectMarkdown } from "../src/domain/project-export";
import { bundleFiles, dtcg } from "../src/server/exports/bundle";

it.each([
  ["#206493", 16, "serif"],
  ["#845034", 18, "monospace"],
] as const)(
  "Markdown frontmatter stays pinned to saved %s / %ipx",
  (accent, fontSize, fontFamily) => {
    const directory = mkdtempSync(join(tmpdir(), "markdown-revision-"));
    const service = new ProjectService(directory);
    try {
      const p = service.create(
        briefSchema.parse({ name: "Saved tokens", purpose: "Keep rationale" }),
        false,
      );
      const foundation = service.scope(p.id).foundation;
      foundation.save(
        1,
        { ...foundation.current()!.design, accent, fontSize, fontFamily },
        "Synthetic edit",
        randomUUID(),
      );
      const saved = service.revision(p.id, 2);
      const rows = service
        .scope(p.id)
        .references.db.prepare(
          "SELECT revision,data FROM foundation_revisions ORDER BY revision",
        )
        .all();
      foundation.save(
        2,
        { ...saved.design, accent: "#abcdef", fontSize: 12 },
        "Later edit",
        randomUUID(),
      );
      const beforeExport = service
        .scope(p.id)
        .references.db.prepare(
          "SELECT revision,data FROM foundation_revisions ORDER BY revision",
        )
        .all();
      const markdown = projectMarkdown(service.revision(p.id, 2));
      const [frontmatter, body] = markdown.slice(4).split("\n---\n");
      expect(frontmatter).toBe(
        `name: "Saved tokens"\ncolors:\n  primary: "${accent}"\ntypography:\n  body-md:\n    fontFamily: "${fontFamily}"\n    fontSize: ${fontSize}px`,
      );
      expect(body).toContain(`"projectId":"${p.id}","revision":2`);
      expect(body).toContain("sourceTasteProfileRevision");
      expect(body).toContain(`# Design System\n`);
      expect(body).toContain(
        `- Accent: ${accent}\n- Body font size: ${fontSize}px`,
      );
      expect(body).toContain("- 用途: Keep rationale");
      expect(body).toContain("## このプロジェクト固有の方針・例外");
      const bundle = bundleFiles(saved);
      expect(
        bundle.files["DESIGN.md"].startsWith(`---\n${frontmatter}\n---\n`),
      ).toBe(true);
      expect(JSON.parse(bundle.files["tokens/tokens.json"])).toEqual({
        ...dtcg(saved.design),
        $description: `Project ${p.id}, revision 2, Draft`,
      });
      expect(JSON.parse(bundle.files["design-system.json"]).design).toEqual(
        saved.design,
      );
      expect(service.revision(p.id).design.accent).toBe("#abcdef");
      expect(
        service
          .scope(p.id)
          .references.db.prepare(
            "SELECT revision,data FROM foundation_revisions ORDER BY revision",
          )
          .all(),
      ).toEqual(beforeExport);
      expect(beforeExport.slice(0, 2)).toEqual(rows);
    } finally {
      service.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("quotes Project names without allowing new YAML keys or line-break folding", () => {
  const directory = mkdtempSync(join(tmpdir(), "markdown-name-"));
  const service = new ProjectService(directory);
  try {
    const name =
      'Project: "quoted"\\name\n---\ncolors: injected\u007f\u0086\u0085next\u2028line\u2029end';
    const p = service.create(briefSchema.parse({ name }), false);
    const markdown = projectMarkdown(service.revision(p.id));
    const line = markdown.split("\n")[1];
    expect(JSON.parse(line.slice("name: ".length))).toBe(name);
    expect(line).not.toMatch(/[\u007f-\u009f\u2028\u2029]/);
    const header = markdown.slice(0, markdown.indexOf("\n---\n", 4) + 5);
    expect(header.match(/^---$/gm)).toHaveLength(2);
    expect(markdown).toContain(`- 名前: ${name}`);
  } finally {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
