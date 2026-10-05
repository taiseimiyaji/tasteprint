import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initialState, type Reference } from "../src/client/state";
import { defaultDesign } from "../src/domain/design";
import { ProjectService } from "../src/server/projects/service";
import { ReferenceService } from "../src/server/references/service";
import { FoundationService } from "../src/server/foundation/service";
import { CodexGateway } from "../src/server/codex/gateway";

afterEach(() => vi.restoreAllMocks());
const legacy = (
  id: string,
  name: string,
  url: string,
  aspect: "Density" | "Colors" = "Density",
): Reference => ({
  id,
  name,
  url,
  aspects: [aspect],
  principles: [
    {
      aspect,
      observation: `${name} observation`,
      interpretation: `${name} interpretation`,
      recommendation: `${name} principle`,
      certainty: "medium",
      evidence: `${name} evidence`,
    },
  ],
});

it("keeps distinct same-URL, empty-URL and different-URL legacy records, deduplicates IDs and preserves completed replay across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "browser-reference-migration-"));
  const gateway = vi
    .spyOn(CodexGateway.prototype, "run")
    .mockRejectedValue(new Error("Real AI forbidden"));
  let service = new ProjectService(directory);
  try {
    const sources = [
      legacy("density-one", "Density one", "https://example.com/shared"),
      legacy(
        "colors-two",
        "Colors two",
        "https://example.com/shared",
        "Colors",
      ),
      legacy("other-three", "Other three", "https://example.com/other"),
      legacy("empty-four", "Empty four", ""),
      legacy("empty-five", "Empty five", "", "Colors"),
    ];
    const raw = {
      ...structuredClone(initialState),
      references: [
        ...sources,
        legacy("density-one", "Repeated ID", "https://example.com/repeated"),
      ],
    };
    const result = await service.importBrowser(raw);
    const scope = service.scope(result.projectId);
    const rows = scope.references.references();
    expect(rows.map((row) => row.name)).toEqual(
      sources.map((source) => source.name),
    );
    expect(new Set(rows.map((row) => row.id)).size).toBe(5);
    for (const [index, source] of sources.entries()) {
      expect(rows[index]).toMatchObject({
        name: source.name,
        url: source.url,
        selections: [{ aspect: source.aspects[0], intent: "reference" }],
        accepted: [0],
        analysis: { findings: source.principles },
      });
    }
    expect(service.revision(result.projectId).snapshot.references).toEqual(
      rows,
    );
    const backupPath = join(
      directory,
      "backup-before-projects",
      result.backup + ".json",
    );
    const originalBackup = readFileSync(backupPath, "utf8");
    expect(originalBackup).toBe(JSON.stringify(raw));
    const referenceRows = scope.references.db
      .prepare("SELECT rowid,data FROM refs ORDER BY rowid")
      .all();
    const revisionRows = scope.references.db
      .prepare(
        "SELECT revision,data FROM foundation_revisions ORDER BY revision",
      )
      .all();
    const marker = service.db
      .prepare("SELECT data FROM migrations WHERE id=?")
      .get(result.backup);
    expect(marker).toBeDefined();
    expect(await service.importBrowser(raw)).toEqual(result);
    expect(
      scope.references.db
        .prepare("SELECT rowid,data FROM refs ORDER BY rowid")
        .all(),
    ).toEqual(referenceRows);
    expect(
      scope.references.db
        .prepare(
          "SELECT revision,data FROM foundation_revisions ORDER BY revision",
        )
        .all(),
    ).toEqual(revisionRows);
    await service.close();
    service = new ProjectService(directory);
    expect(await service.importBrowser(raw)).toEqual(result);
    const reopened = service.scope(result.projectId);
    expect(reopened.references.references()).toEqual(rows);
    expect(
      reopened.references.db
        .prepare("SELECT rowid,data FROM refs ORDER BY rowid")
        .all(),
    ).toEqual(referenceRows);
    expect(
      reopened.references.db
        .prepare(
          "SELECT revision,data FROM foundation_revisions ORDER BY revision",
        )
        .all(),
    ).toEqual(revisionRows);
    expect(
      service.db
        .prepare("SELECT data FROM migrations WHERE id=?")
        .get(result.backup),
    ).toEqual(marker);
    expect(readFileSync(backupPath, "utf8")).toBe(originalBackup);
    expect(gateway).not.toHaveBeenCalled();
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps existing SQLite URL and ID matching while retaining multiple new same-URL records in that payload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-reference-migration-"));
  const gateway = vi
    .spyOn(CodexGateway.prototype, "run")
    .mockRejectedValue(new Error("Real AI forbidden"));
  const old = new ReferenceService(directory);
  const existing = old.create({
    name: "Existing SQLite",
    url: "https://example.com/existing",
    selections: [{ aspect: "Density", intent: "avoid" }],
    likes: "Retained notes",
    dislikes: "",
  });
  const oldRow = old.db
    .prepare("SELECT rowid,data FROM refs WHERE id=?")
    .get(existing.id);
  new FoundationService(old.db).initialize({ ...defaultDesign, radius: 9 });
  const oldRevision = old.db
    .prepare("SELECT data FROM foundation_revisions WHERE revision=1")
    .get();
  await old.close();
  const service = new ProjectService(directory);
  try {
    const sources = [
      legacy("new-one", "New one", "https://example.com/new"),
      legacy("new-two", "New two", "https://example.com/new", "Colors"),
    ];
    const raw = {
      ...structuredClone(initialState),
      design: { ...defaultDesign, radius: 17 },
      references: [
        legacy("url-match-one", "Existing URL one", existing.url),
        legacy("url-match-two", "Existing URL two", existing.url, "Colors"),
        legacy(existing.id, "Existing ID", "https://example.com/changed"),
        ...sources,
      ],
    };
    const result = await service.importBrowser(raw);
    const scope = service.scope(result.projectId);
    expect(scope.references.references().map((row) => row.name)).toEqual([
      existing.name,
      ...sources.map((source) => source.name),
    ]);
    expect(
      scope.references.db
        .prepare("SELECT rowid,data FROM refs WHERE id=?")
        .get(existing.id),
    ).toEqual(oldRow);
    expect(
      scope.references.db
        .prepare("SELECT data FROM foundation_revisions WHERE revision=1")
        .get(),
    ).toEqual(oldRevision);
    expect(service.revision(result.projectId).design.radius).toBe(9);
    expect(
      scope.references
        .references()
        .slice(1)
        .map((row) => row.analysis!.findings),
    ).toEqual(sources.map((source) => source.principles));
    expect(service.revision(result.projectId).snapshot.references).toEqual(
      scope.references.references(),
    );
    expect(
      readFileSync(
        join(directory, "backup-before-projects", result.backup + ".json"),
        "utf8",
      ),
    ).toBe(JSON.stringify(raw));
    expect(gateway).not.toHaveBeenCalled();
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
