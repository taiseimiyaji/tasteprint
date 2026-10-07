import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { ProjectService } from "../src/server/projects/service";
import { ReviewService } from "../src/server/review/service";
import { briefSchema } from "../src/domain/projects";
import type { SavedReference } from "../src/domain/reference";

const instances: ProjectService[] = [],
  directories: string[] = [];
afterEach(async () => {
  for (const s of instances.splice(0)) await s.close();
  for (const d of directories.splice(0))
    rmSync(d, { recursive: true, force: true });
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "reference-policy-"));
  directories.push(dir);
  const inputs: string[] = [];
  const s = new ProjectService(dir, {
    generate: async (design) => ({
      candidates: [{ design, explanation: "unchanged" }],
    }),
  });
  instances.push(s);
  const p = s.create(briefSchema.parse({ name: "Policy fixture" }), false);
  return { s, p, scope: s.scope(p.id), inputs };
}
function analyzed(f: ReturnType<typeof setup>, name = "Controlled reference") {
  const r = f.scope.references.create({
    name,
    url: "",
    selections: [{ aspect: "Typography", intent: "reference" }],
    likes: "",
    dislikes: "",
  });
  const record: SavedReference = {
    ...r,
    version: 2,
    analysis: {
      referenceId: r.id,
      findings: [
        {
          aspect: "Typography",
          observation: "heading",
          interpretation: "clear hierarchy",
          recommendation: "CONTROL_REFERENCE_POLICY",
          certainty: "medium",
          evidence: "top heading",
        },
        {
          aspect: "Spacing",
          observation: "gap",
          interpretation: "separation",
          recommendation: "CONTROL_UNADOPTED",
          certainty: "medium",
          evidence: "page gap",
        },
      ],
    },
  };
  f.scope.references.db
    .prepare("UPDATE refs SET data=? WHERE id=?")
    .run(JSON.stringify(record), r.id);
  return record;
}
function rows(f: ReturnType<typeof setup>) {
  return {
    reference: f.scope.references.references(),
    history: f.scope.references.db
      .prepare(
        "SELECT revision,data FROM foundation_revisions ORDER BY revision",
      )
      .all(),
    requests: f.scope.references.db
      .prepare("SELECT * FROM foundation_requests")
      .all(),
  };
}
it("atomically saves source acceptance and one policy in a new immutable revision without numerical, shared or cross-project changes", async () => {
  const f = setup(),
    r = analyzed(f),
    before = rows(f),
    shared = f.s.taste(),
    other = f.s.create(briefSchema.parse({ name: "Other" }), false),
    otherRevision = f.s.revision(other.id);
  const result = f.s.adoptReference(f.p.id, r.id, 2, 0, 1);
  expect(result.reference?.accepted).toEqual([0]);
  expect(result.reference?.version).toBe(3);
  expect(result.revision.revision).toBe(2);
  expect(result.revision.design).toEqual(f.s.revision(f.p.id, 1).design);
  expect(result.revision.snapshot?.policies).toEqual([
    {
      id: `reference:${r.id}:0`,
      target: "Typography",
      text: "CONTROL_REFERENCE_POLICY",
      reason: "clear hierarchy",
      sources: [r.name, "top heading"],
      locked: false,
    },
  ]);
  expect(JSON.stringify(result.revision.snapshot?.references)).toContain(
    "CONTROL_REFERENCE_POLICY",
  );
  expect(JSON.stringify(result.revision.snapshot?.references)).not.toContain(
    "CONTROL_UNADOPTED",
  );
  expect(rows(f).history[0]).toEqual(before.history[0]);
  expect(f.s.taste()).toEqual(shared);
  expect(f.s.revision(other.id)).toEqual(otherRevision);
  const reviewInputs: unknown[] = [];
  const reviewer = new ReviewService(
    f.scope.foundation,
    async () => ({
      image: Buffer.from("mock capture"),
      findings: [],
      verifiedRules: [],
      scope: ["mock"],
    }),
    async (review) => {
      reviewInputs.push(structuredClone(review));
      return { findings: [] };
    },
  );
  const reviewed = await reviewer.run(2, new AbortController().signal);
  expect(reviewed.status).toBe("complete");
  expect(JSON.stringify(reviewInputs)).toContain(`project.reference:${r.id}:0`);
  expect(JSON.stringify(reviewInputs)).not.toContain("CONTROL_UNADOPTED");
  const bundle = await f.s.exportBundle(f.p.id, 2, "omit"),
    zipName = Object.keys(bundle.files).find((n) => n.endsWith(".zip"))!;
  const entries = unzipSync(Buffer.from(bundle.files[zipName], "base64")),
    jsonPath = Object.keys(entries).find((n) =>
      n.endsWith("/design-system.json"),
    )!;
  const json = JSON.parse(strFromU8(entries[jsonPath]));
  expect(json.policies[0].text).toBe("CONTROL_REFERENCE_POLICY");
  expect(JSON.stringify(json)).not.toContain("CONTROL_UNADOPTED");
});
it("replays exactly one operation before stale source/base validation and reports newer or deleted source state", () => {
  const f = setup(),
    r = analyzed(f),
    a = f.s.adoptReference(f.p.id, r.id, 2, 0, 1);
  expect(f.s.adoptReference(f.p.id, r.id, 2, 0, 1)).toEqual(a);
  expect(f.scope.foundation.history()).toHaveLength(2);
  expect(f.scope.references.reference(r.id).version).toBe(3);
  const updated = f.scope.references.update(r.id, 3, {
    name: "Updated source",
    url: "",
    selections: r.selections,
    likes: "new",
    dislikes: "",
  });
  expect(f.s.adoptReference(f.p.id, r.id, 2, 0, 1)).toEqual({
    revision: a.revision,
    reference: updated,
  });
  f.scope.references.remove(r.id, updated.version);
  expect(f.s.adoptReference(f.p.id, r.id, 2, 0, 1)).toEqual({
    revision: a.revision,
    reference: null,
  });
  expect(f.s.referenceAdoptionResult(f.p.id, r.id, 2, 0, 1)?.revision).toEqual(
    a.revision,
  );
  expect(f.s.referenceAdoptionResult(f.p.id, r.id, 2, 1, 1)).toBeNull();
  expect(f.s.referenceAdoptionResult(f.p.id, r.id, 3, 0, 1)).toBeNull();
  f.s.archive(f.p.id, 2, true);
  expect(() => f.s.adoptReference(f.p.id, r.id, 2, 0, 1)).toThrow(
    "アーカイブ中",
  );
  expect(f.s.referenceAdoptionResult(f.p.id, r.id, 2, 0, 1)?.revision).toEqual(
    a.revision,
  );
});
it.each(["base", "version", "index", "project"])(
  "rejects invalid %s before source acceptance or revision/request writes",
  (kind) => {
    const f = setup(),
      r = analyzed(f),
      before = rows(f);
    const id =
      kind === "project"
        ? f.s.create(briefSchema.parse({ name: "Other" }), false).id
        : f.p.id;
    expect(() =>
      f.s.adoptReference(
        id,
        r.id,
        kind === "version" ? 1 : 2,
        kind === "index" ? 20 : 0,
        kind === "base" ? 2 : 1,
      ),
    ).toThrow();
    expect(rows(f)).toEqual(before);
  },
);
it("keeps existing policy IDs and conflicting targets without overwriting or partially accepting the reference", () => {
  for (const duplicate of [true, false]) {
    const f = setup(),
      r = analyzed(f);
    const policy = {
      id: duplicate ? `reference:${r.id}:0` : "existing",
      target: "Typography",
      text: "Existing user policy",
      reason: "user",
      sources: [],
      locked: false,
    };
    f.s.saveProject(f.p.id, 1, f.p.brief, [policy]);
    const before = rows(f);
    expect(() => f.s.adoptReference(f.p.id, r.id, 2, 0, 2)).toThrow(
      duplicate ? "保存済み" : "矛盾",
    );
    expect(rows(f)).toEqual(before);
  }
});
it("rejects the 101st policy while allowing the 100th, before any partial reference write", () => {
  for (const count of [99, 100]) {
    const f = setup(),
      r = analyzed(f);
    f.s.saveProject(
      f.p.id,
      1,
      f.p.brief,
      Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        target: `t${i}`,
        text: "Existing",
        reason: "",
        sources: [],
        locked: false,
      })),
    );
    const before = rows(f);
    if (count === 100) {
      expect(() => f.s.adoptReference(f.p.id, r.id, 2, 0, 2)).toThrow();
      expect(rows(f)).toEqual(before);
    } else
      expect(
        f.s.adoptReference(f.p.id, r.id, 2, 0, 2).revision.snapshot?.policies,
      ).toHaveLength(100);
  }
});
it("rolls acceptance, revision and request writes back together when revision insert fails", () => {
  const f = setup(),
    r = analyzed(f),
    before = rows(f);
  f.scope.references.db.exec(
    "CREATE TRIGGER fail_adoption BEFORE INSERT ON foundation_revisions BEGIN SELECT RAISE(ABORT,'injected revision failure'); END",
  );
  expect(() => f.s.adoptReference(f.p.id, r.id, 2, 0, 1)).toThrow(
    "injected revision failure",
  );
  expect(rows(f)).toEqual(before);
  expect(f.s.referenceAdoptionResult(f.p.id, r.id, 2, 0, 1)).toBeNull();
  f.scope.references.db.exec("DROP TRIGGER fail_adoption");
  expect(f.s.adoptReference(f.p.id, r.id, 2, 0, 1).revision.revision).toBe(2);
});
it("explicitly upgrades a legacy accepted source into a policy without rewriting old revisions or accepting it twice", () => {
  const f = setup(),
    r = analyzed(f),
    legacy = f.scope.references.accept(r.id, 2, 0),
    before = rows(f);
  const result = f.s.adoptReference(f.p.id, r.id, legacy.version, 0, 1);
  expect(result.reference?.version).toBe(legacy.version);
  expect(result.revision.snapshot?.policies).toHaveLength(1);
  expect(rows(f).history[0]).toEqual(before.history[0]);
});
