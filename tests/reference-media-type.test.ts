import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ProjectService } from "../src/server/projects/service";
import { ReferenceService } from "../src/server/references/service";
import { referenceRoutes } from "../src/server/references/routes";
import { initialState } from "../src/client/state";

const directories: string[] = [];
const services: (ProjectService | ReferenceService)[] = [];
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), "reference-media-"));
  directories.push(path);
  return path;
};
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
const input = {
  name: "Image format fixture",
  url: "",
  likes: "",
  dislikes: "",
  selections: [{ aspect: "Typography" as const, intent: "reference" as const }],
};
async function imageResponse(service: ReferenceService, id: string) {
  const app = referenceRoutes(service, "fixture"),
    origin = "http://localhost:3000";
  const paired = await app.request(`${origin}/pair`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "fixture" }),
  });
  expect(paired.status).toBe(200);
  return app.request(`${origin}/${id}/image`, {
    headers: {
      cookie: paired.headers.get("set-cookie")!.split(";")[0],
      origin,
    },
  });
}
const encoded = (format: "png" | "jpeg" | "webp") =>
  sharp({
    create: { width: 160, height: 90, channels: 3, background: "#345678" },
  })
    [format]()
    .toBuffer();

it.each(["png", "jpeg", "webp"] as const)(
  "existing imported %s bytes receive matching media types without rewriting assets or history",
  async (format) => {
    const path = directory();
    let service = new ProjectService(path);
    services.push(service);
    const bytes = await encoded(format);
    const raw = {
      ...initialState,
      references: [
        {
          id: randomUUID(),
          name: `Legacy ${format}`,
          url: "",
          aspects: ["Typography"],
          image: `data:image/${format};base64,${bytes.toString("base64")}`,
        },
      ],
    };
    const imported = await service.importBrowser(raw);
    let scope = service.scope(imported.projectId);
    const reference = scope.references.references()[0];
    const assetPath = scope.references.assetPath(reference.assetId!);
    const original = service.revision(imported.projectId);
    // Seed an existing pre-fix immutable snapshot, which mislabeled JPEG/WebP as PNG.
    const old = structuredClone(original);
    (old.snapshot.references[0] as { image: string }).image =
      `data:image/png;base64,${bytes.toString("base64")}`;
    scope.references.db
      .prepare("UPDATE foundation_revisions SET data=? WHERE revision=?")
      .run(JSON.stringify(old), old.revision);
    const rows = scope.references.db
      .prepare(
        "SELECT revision,data FROM foundation_revisions ORDER BY revision",
      )
      .all();
    const referenceRow = scope.references.db
      .prepare("SELECT data FROM refs WHERE id=?")
      .get(reference.id)!.data;
    const importRow = scope.references.db
      .prepare("SELECT data FROM browser_imports WHERE id=?")
      .get(imported.backup)!.data;
    const modification = statSync(assetPath, { bigint: true }).mtimeNs;
    const backupPath = join(
      path,
      "backup-before-projects",
      `${imported.backup}.json`,
    );
    expect(readFileSync(backupPath, "utf8")).toBe(JSON.stringify(raw));
    await service.close();
    services.splice(services.indexOf(service), 1);
    service = new ProjectService(path);
    services.push(service);
    scope = service.scope(imported.projectId);
    const response = await imageResponse(scope.references, reference.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(`image/${format}`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(bytes)).toBe(true);
    expect(await sharp(body).metadata()).toMatchObject({
      format,
      width: 160,
      height: 90,
    });
    const frozen = service.freezeReferences(scope.references)[0] as {
      image: string;
    };
    expect(frozen.image).toBe(raw.references[0].image);
    expect(service.revision(imported.projectId)).toEqual(old);
    const next = scope.foundation.save(
      old.revision,
      { ...old.design, radius: old.design.radius + 1 },
      "Explicit new revision",
      randomUUID(),
    );
    expect((next.snapshot!.references[0] as { image: string }).image).toBe(
      raw.references[0].image,
    );
    expect(
      scope.references.db
        .prepare(
          "SELECT revision,data FROM foundation_revisions WHERE revision<=? ORDER BY revision",
        )
        .all(old.revision),
    ).toEqual(rows);
    expect(
      scope.references.db
        .prepare("SELECT data FROM refs WHERE id=?")
        .get(reference.id)!.data,
    ).toBe(referenceRow);
    expect(
      scope.references.db
        .prepare("SELECT data FROM browser_imports WHERE id=?")
        .get(imported.backup)!.data,
    ).toBe(importRow);
    expect(readFileSync(backupPath, "utf8")).toBe(JSON.stringify(raw));
    expect(readFileSync(assetPath).equals(bytes)).toBe(true);
    expect(statSync(assetPath, { bigint: true }).mtimeNs).toBe(modification);
    expect(await service.importBrowser(raw)).toEqual(imported);
    expect(scope.foundation.current()!.revision).toBe(next.revision);
  },
);

it.each(["png", "jpeg", "webp"] as const)(
  "ordinary %s uploads still serve re-encoded PNG",
  async (format) => {
    const service = new ReferenceService(directory());
    services.push(service);
    const created = service.create(input);
    const uploaded = await service.upload(
      created.id,
      created.version,
      await encoded(format),
    );
    const response = await imageResponse(service, uploaded.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(await sharp(bytes).metadata()).toMatchObject({
      format: "png",
      width: 160,
      height: 90,
    });
    expect(bytes.equals(service.asset(uploaded.id))).toBe(true);
  },
);

it("unknown or truncated legacy bytes retain the old PNG fallback and are not rewritten or newly rejected", async () => {
  const service = new ReferenceService(directory());
  services.push(service);
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from([0xff, 0xd8]),
    Buffer.from("RIFFxxxxWEB"),
    Buffer.from([0xd2, 0xc9, 0xc6, 0xc6, 0, 0, 0, 0, 0xd7, 0xc5, 0xc2, 0xd0]),
    Buffer.from("legacy unknown"),
  ]) {
    const reference = service.create(input),
      assetId = randomUUID();
    writeFileSync(service.assetPath(assetId), bytes);
    service.db
      .prepare("UPDATE refs SET data=? WHERE id=?")
      .run(JSON.stringify({ ...reference, assetId }), reference.id);
    const response = await imageResponse(service, reference.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    expect(readFileSync(service.assetPath(assetId)).equals(bytes)).toBe(true);
  }
});
