import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { defaultDesign } from "../src/domain/design";
import type { StoredReview } from "../src/domain/review";
import { FoundationService } from "../src/server/foundation/service";
import { ReviewService } from "../src/server/review/service";

const directories: string[] = [];
const connections: DatabaseSync[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function database() {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-review-version-"));
  directories.push(dir);
  return join(dir, "references.sqlite");
}
function connect(path: string) {
  const db = new DatabaseSync(path, { timeout: 25 });
  connections.push(db);
  return db;
}
function service(db: DatabaseSync) {
  const foundation = new FoundationService(db);
  const reviews = new ReviewService(foundation, async () => {
    throw new Error("capture must not run");
  });
  return { foundation, reviews };
}
function storedReview(): StoredReview {
  return {
    id: randomUUID(),
    baseRevision: 1,
    createdAt: "2026-10-14T00:00:00.000Z",
    design: defaultDesign,
    dna: {},
    rules: [],
    findings: [
      {
        id: randomUUID(),
        source: "machine",
        ruleId: "states",
        targetPath: "button",
        severity: "warning",
        evidence: "fixture",
        explanation: "fixture",
        suggestedChange: "fixture",
      },
    ],
    verifiedRules: [],
    scope: [],
    images: [],
    status: "complete",
  };
}
function row(db: DatabaseSync, id: string) {
  return db
    .prepare(
      "SELECT rowid, hex(CAST(data AS BLOB)) AS bytes, state_version AS version FROM reviews WHERE id=?",
    )
    .get(id)!;
}

it("adds a durable column without rewriting legacy Review, image or Foundation bytes", () => {
  const path = database();
  const db = connect(path);
  const foundation = new FoundationService(db);
  foundation.initialize();
  db.exec(
    "CREATE TABLE reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE review_images (id TEXT PRIMARY KEY, data BLOB NOT NULL)",
  );
  const review = storedReview();
  const oldJson = JSON.stringify(
    { ...review, stale: true, stateVersion: 88 },
    null,
    2,
  );
  const image = Uint8Array.of(0, 255, 1, 37);
  db.prepare("INSERT INTO reviews VALUES (?,?)").run(review.id, oldJson);
  db.prepare("INSERT INTO review_images VALUES (?,?)").run("image", image);
  const beforeReview = db
    .prepare(
      "SELECT rowid, hex(CAST(data AS BLOB)) AS bytes FROM reviews WHERE id=?",
    )
    .get(review.id);
  const beforeFoundation = db
    .prepare(
      "SELECT hex(CAST(data AS BLOB)) AS bytes FROM foundation_revisions",
    )
    .all();
  const beforeImage = db
    .prepare("SELECT hex(data) AS bytes FROM review_images WHERE id='image'")
    .get();
  let reviews = new ReviewService(foundation, async () => {
    throw new Error("capture must not run");
  });
  expect(reviews.get(review.id)).toMatchObject({
    stateVersion: 0,
    stale: false,
  });
  expect(row(db, review.id)).toMatchObject({ ...beforeReview, version: 0 });
  db.close();
  connections.splice(connections.indexOf(db), 1);
  const reopened = connect(path);
  reviews = service(reopened).reviews;
  expect(row(reopened, review.id)).toMatchObject({
    ...beforeReview,
    version: 0,
  });
  expect(
    reopened
      .prepare(
        "SELECT hex(CAST(data AS BLOB)) AS bytes FROM foundation_revisions",
      )
      .all(),
  ).toEqual(beforeFoundation);
  expect(
    reopened
      .prepare("SELECT hex(data) AS bytes FROM review_images WHERE id='image'")
      .get(),
  ).toEqual(beforeImage);
  expect(
    reviews.dismiss(review.id, review.findings[0].id, "new", 1),
  ).toMatchObject({
    stateVersion: 1,
    findings: [{ dismissal: "new" }],
  });
  expect(row(reopened, review.id).rowid).toBe(beforeReview!.rowid);
  expect(
    JSON.parse(
      String(
        reopened.prepare("SELECT data FROM reviews WHERE id=?").get(review.id)!
          .data,
      ),
    ),
  ).not.toHaveProperty("stateVersion");
});

it("serializes two connections and rolls back failed writes without changing reason or version", () => {
  const path = database();
  const first = connect(path);
  const { foundation, reviews: a } = service(first);
  foundation.initialize();
  const review = storedReview();
  first
    .prepare("INSERT INTO reviews(id,data) VALUES (?,?)")
    .run(review.id, JSON.stringify(review));
  const second = connect(path);
  const b = service(second).reviews;
  const findingId = review.findings[0].id;
  expect(a.dismiss(review.id, findingId, "one", 1).stateVersion).toBe(1);
  expect(b.dismiss(review.id, findingId, "two", 1)).toMatchObject({
    stateVersion: 2,
    findings: [{ dismissal: "two" }],
  });
  first.exec("BEGIN IMMEDIATE");
  expect(() => b.dismiss(review.id, findingId, "locked", 1)).toThrow();
  expect(a.get(review.id).stateVersion).toBe(2);
  first.exec("COMMIT");
  expect(b.dismiss(review.id, findingId, "three", 1).stateVersion).toBe(3);
  first.exec(
    "CREATE TRIGGER fail_review_update AFTER UPDATE ON reviews BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  expect(() => a.dismiss(review.id, findingId, "not saved", 1)).toThrow(
    /test failure/,
  );
  expect(b.get(review.id)).toMatchObject({
    stateVersion: 3,
    findings: [{ dismissal: "three" }],
  });
  first.exec("DROP TRIGGER fail_review_update");
  expect(() => a.dismiss(review.id, randomUUID(), "missing", 1)).toThrow(
    /指摘がありません/,
  );
  foundation.save(1, defaultDesign, "new revision", randomUUID());
  expect(() => a.dismiss(review.id, findingId, "old revision", 1)).toThrow(
    /古いrevision/,
  );
  expect(b.get(review.id).stateVersion).toBe(3);
  // An existing historical Review can still be dismissed through the service.
  expect(b.dismiss(review.id, findingId, "historical").stateVersion).toBe(4);
});
