// Optional independent interoperability check; not an application dependency.
// node --import tsx tests/verify-design-md.ts /path/to/@google/design.md /tmp/evidence
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import { projectMarkdown } from "../src/domain/project-export";

const [packageDirectory, outputDirectory] = process.argv.slice(2);
assert(
  packageDirectory && outputDirectory,
  "Supply the pinned CLI package directory and an evidence directory",
);
const cli = resolve(packageDirectory);
const output = resolve(outputDirectory);
const cliPackage = JSON.parse(readFileSync(join(cli, "package.json"), "utf8"));
assert.equal(cliPackage.name, "@google/design.md");
assert.equal(cliPackage.version, "0.4.0");
mkdirSync(output, { recursive: true });
const { lint: officialLint } = await import(
  pathToFileURL(join(cli, "dist/linter/index.js")).href
);
const directory = mkdtempSync(join(tmpdir(), "design-md-cli-"));
const service = new ProjectService(directory);
try {
  const name =
    'Synthetic: "quoted"\n---\ncolors: not-a-token\u007f\u0086\u0085next\u2028line\u2029end';
  const project = service.create(briefSchema.parse({ name }), false);
  const f = service.scope(project.id).foundation;
  f.save(
    1,
    {
      ...f.current()!.design,
      accent: "#206493",
      fontFamily: "serif",
      fontSize: 16,
    },
    "Synthetic saved edit",
    randomUUID(),
  );
  const saved = service.revision(project.id, 2);
  f.save(
    2,
    { ...saved.design, accent: "#845034", fontSize: 18 },
    "Later edit excluded from r2",
    randomUUID(),
  );
  const record = await service.exportBundle(project.id, 2, "omit");
  const zip = record.binaryFiles!.find((p) => p.endsWith(".zip"))!;
  const bytes = Buffer.from(record.files[zip], "base64");
  writeFileSync(join(output, "saved-r2.zip"), bytes);
  const files = unzipSync(bytes);
  const read = (suffix: string) => {
    const key = Object.keys(files).find((p) => p.endsWith(`/${suffix}`));
    assert(key, `Missing ${suffix}`);
    return strFromU8(files[key]);
  };
  const markdown = read("DESIGN.md");
  const bundled = JSON.parse(read("tokens/tokens.json"));
  const bundledHex =
    "#" +
    bundled["color-accent"].$value.components
      .map((n: number) =>
        Math.round(n * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const variants = { bundle: markdown, standalone: projectMarkdown(saved) };
  const results = [];
  for (const [kind, text] of Object.entries(variants)) {
    const file = join(output, `${kind}-DESIGN.md`);
    writeFileSync(file, text);
    const run = (args: string[], target: string) => {
      const result = spawnSync(
        process.execPath,
        [join(cli, "dist/index.js"), ...args, file],
        {
          encoding: "utf8",
          env: { PATH: process.env.PATH, HOME: directory, TMPDIR: tmpdir() },
        },
      );
      writeFileSync(join(output, target), result.stdout ?? "");
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      return JSON.parse(result.stdout);
    };
    const lint = run(["lint"], `${kind}-lint.json`);
    assert.equal(lint.summary.errors, 0);
    assert.equal(lint.summary.warnings, 0);
    assert.equal(officialLint(text).designSystem.name, name);
    const converted = run(
      ["export", "--format", "dtcg"],
      `${kind}-google-dtcg.json`,
    );
    assert.equal(converted.color.primary.$value.hex, saved.design.accent);
    assert.equal(converted.color.primary.$value.hex, bundledHex);
    assert.deepEqual(
      converted.typography["body-md"].$value.fontSize,
      bundled["font-size-body"].$value,
    );
    assert.deepEqual(converted.typography["body-md"].$value.fontSize, {
      value: saved.design.fontSize,
      unit: "px",
    });
    assert.equal(
      converted.typography["body-md"].$value.fontFamily,
      saved.design.fontFamily,
    );
    results.push({
      kind,
      projectId: project.id,
      revision: saved.revision,
      templateVersion: record.templateVersion,
      lint: lint.summary,
      hex: bundledHex,
      fontSize: converted.typography["body-md"].$value.fontSize,
    });
  }
  assert.equal(service.revision(project.id).revision, 3);
  const report = {
    cliVersion: "0.4.0",
    results,
    unverified: [
      "Stitch import",
      "other CLI versions/tools",
      "agent visual reproduction",
    ],
  };
  writeFileSync(
    join(output, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  service.close();
  rmSync(directory, { recursive: true, force: true });
}
