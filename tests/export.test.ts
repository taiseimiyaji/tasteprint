import { it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { ProjectService } from "../src/server/projects/service";
import { briefSchema } from "../src/domain/projects";
import { defaultDesign } from "../src/domain/design";
import { bundleFiles, dtcg } from "../src/server/exports/bundle";
import type { CaptureReview } from "../src/server/review/capture";
import sharp from "sharp";

it("freezes a revision across capture/edit, excludes proposals and private data, verifies ZIP hashes and typechecks portable React", async () => {
  const dir = mkdtempSync(join(tmpdir(), "export-"));
  let service!: ProjectService;
  let id = "";
  const seen: number[] = [];
  const capture: CaptureReview = async (design) => {
    seen.push(design.radius);
    if (seen.length === 1) {
      const f = service.scope(id).foundation;
      f.save(
        1,
        { ...defaultDesign, radius: 19 },
        "edit during export",
        crypto.randomUUID(),
      );
    }
    return {
      image: await sharp({
        create: { width: 10, height: 10, channels: 4, background: "white" },
      })
        .png()
        .toBuffer(),
      findings: [],
      verifiedRules: [],
      scope: [],
    };
  };
  service = new ProjectService(join(dir, "data"), {
    exportCapture: capture,
    generate: async (d) => ({
      candidates: [
        { design: { ...d, radius: 17 }, explanation: "UNADOPTED_SECRET" },
      ],
    }),
  });
  try {
    const project = service.create(
      briefSchema.parse({ name: "Export" }),
      false,
    );
    id = project.id;
    await service
      .scope(id)
      .foundation.propose(1, "UNADOPTED_SECRET", new AbortController().signal);
    service.addConversation(id, 1, "PRIVATE_CHAT_SECRET");
    const record = await service.exportBundle(id, 1);
    expect(seen).toEqual([6, 6, 6]);
    expect(service.revision(id).design.radius).toBe(19);
    const zipName = record.binaryFiles!.find((n) => n.endsWith(".zip"))!;
    const raw = unzipSync(Buffer.from(record.files[zipName], "base64"));
    const entries = Object.fromEntries(
      Object.entries(raw).map(([n, b]) => [n.split("/").slice(1).join("/"), b]),
    );
    const text = Object.values(entries)
      .map((b) => Buffer.from(b).toString())
      .join("\n");
    expect(text).not.toContain("PRIVATE_CHAT_SECRET");
    expect(text).not.toContain("UNADOPTED_SECRET");
    const manifest = JSON.parse(
      Buffer.from(entries["manifest.json"]).toString(),
    );
    expect(manifest.revision).toBe(1);
    expect(manifest.status).toBe("Draft");
    expect(manifest.images).toBe("complete");
    expect(Object.keys(entries).filter((n) => n.endsWith(".png"))).toHaveLength(
      3,
    );
    for (const file of manifest.files)
      expect(
        createHash("sha256").update(entries[file.path]).digest("hex"),
      ).toBe(file.sha256);
    const output = join(dir, "output");
    for (const [path, bytes] of Object.entries(entries)) {
      mkdirSync(dirname(join(output, path)), { recursive: true });
      writeFileSync(join(output, path), bytes);
    }
    symlinkSync(resolve("node_modules"), join(output, "node_modules"));
    execFileSync(
      resolve("node_modules/.bin/tsc"),
      ["--project", join(output, "tsconfig.json")],
      { stdio: "pipe" },
    );
    expect((await service.exportBundle(id, 1)).id).toBe(record.id);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("never records failed PNG capture, supports retry and explicit omission, rejects invalid structure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "export-fail-"));
  let calls = 0;
  const service = new ProjectService(dir, {
    exportCapture: async () => {
      calls++;
      throw new Error("failed");
    },
  });
  try {
    const p = service.create(briefSchema.parse({ name: "Failure" }), false);
    await expect(service.exportBundle(p.id, 1)).rejects.toThrow("PNG");
    await expect(service.exportBundle(p.id, 1)).rejects.toThrow("PNG");
    expect(calls).toBe(2);
    expect(service.exports(p.id)).toEqual([]);
    const omitted = await service.exportBundle(p.id, 1, "omit");
    expect(omitted.binaryFiles).toHaveLength(1);
    expect(JSON.parse(omitted.files["manifest.json"]).images).toBe("omitted");
    const revision = service.revision(p.id);
    expect(() =>
      bundleFiles({ ...revision, design: { ...revision.design, radius: -1 } }),
    ).toThrow();
    const reference = {
      name: "source",
      url: "https://user:password@example.com/page?token=SECRET#private",
      accepted: [0],
      analysis: {
        findings: [
          {
            aspect: "Colors",
            recommendation: "adopted",
            interpretation: "reason",
            evidence: "fact",
          },
          {
            aspect: "Colors",
            recommendation: "REJECTED",
            interpretation: "reason",
            evidence: "fact",
          },
        ],
      },
      image: "IMAGE_SECRET",
    };
    revision.snapshot.references = [reference];
    const files = bundleFiles(revision).files;
    expect(files["design-system.json"]).toContain("https://example.com/page");
    expect(JSON.stringify(files)).not.toMatch(/password|SECRET|REJECTED/);
    reference.accepted = [9];
    expect(() => bundleFiles(revision)).toThrow();
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("emits typed DTCG values with resolvable composite aliases", () => {
  const tokens = dtcg({ ...defaultDesign, shadow: true }) as Record<
    string,
    any
  >;
  const aliases = [
    ...JSON.stringify(tokens).matchAll(/\{([a-z][\w-]*)\}/g),
  ].map((m) => m[1]);
  for (const alias of aliases) expect(tokens[alias]?.$type).toBeTruthy();
  expect(tokens["radius-md"]).toEqual({
    $type: "dimension",
    $value: { value: 6, unit: "px" },
  });
  expect(tokens["color-accent"].$value.colorSpace).toBe("srgb");
  expect(tokens["motion-duration"].$value).toEqual({ value: 160, unit: "ms" });
});
