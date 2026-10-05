import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ReferenceService } from "../src/server/references/service";
const input = (name: string) => ({
  name,
  url: "https://example.com",
  selections: [{ aspect: "Colors" as const, intent: "reference" as const }],
  likes: "",
  dislikes: "",
});
const rows = (service: ReferenceService) =>
  service.db.prepare("SELECT rowid,id,data FROM refs ORDER BY rowid").all();
const metadata = {
  capturedAt: "fixture",
  finalUrl: "https://example.com",
  viewport: { width: 10, height: 10 },
  structure: { title: "fixture", headings: [], landmarks: {}, controls: {} },
};

it("keeps existing positions through note, image, capture, analysis and acceptance saves; new IDs append and restart retains rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-list-position-"));
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const capture = vi.fn(async () => ({ image, metadata }));
  const analyze = vi.fn(async (ref: { id: string }) => ({
    referenceId: ref.id,
    findings: [
      {
        aspect: "Colors" as const,
        observation: "color",
        interpretation: "color",
        recommendation: "color",
        certainty: "medium" as const,
        evidence: "fixture",
      },
    ],
  }));
  let service = new ReferenceService(dir, capture, analyze);
  try {
    const refs = ["first", "middle", "last"].map((name) =>
      service.create(input(name)),
    );
    const original = rows(service);
    const ids = refs.map((ref) => ref.id);
    const verify = () => {
      expect(service.references().map((ref) => ref.id)).toEqual(ids);
      expect(
        rows(service).map((row) => ({ rowid: row.rowid, id: row.id })),
      ).toEqual(original.map((row) => ({ rowid: row.rowid, id: row.id })));
      expect(rows(service).filter((row) => row.id !== refs[1].id)).toEqual(
        original.filter((row) => row.id !== refs[1].id),
      );
    };
    let middle = service.update(refs[1].id, 1, {
      ...input("middle"),
      likes: "saved note",
    });
    expect(middle.version).toBe(2);
    verify();
    middle = await service.upload(middle.id, middle.version, image);
    expect(middle.version).toBe(3);
    verify();
    for (const type of ["capture", "analyze"] as const) {
      const job = service.enqueue(
        middle.id,
        middle.version,
        type,
        randomUUID(),
      );
      await vi.waitFor(() =>
        expect(service.job(job.id).state).toBe("succeeded"),
      );
      middle = service.reference(middle.id);
      verify();
    }
    expect(middle.version).toBe(5);
    middle = service.accept(middle.id, middle.version, 0);
    expect(middle.version).toBe(6);
    expect(middle.accepted).toEqual([0]);
    verify();
    expect(middle.likes).toBe("saved note");
    expect(middle.capture).toEqual(metadata);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    const last = service.create(input("new last"));
    expect(service.references().map((ref) => ref.id)).toEqual([
      ...ids,
      last.id,
    ]);
    service.remove(refs[0].id, refs[0].version);
    expect(service.references().map((ref) => ref.id)).toEqual([
      ids[1],
      ids[2],
      last.id,
    ]);
    const beforeRestart = rows(service);
    const beforeEvents = service.db
      .prepare("SELECT * FROM events ORDER BY sequence")
      .all();
    await service.close();
    service = new ReferenceService(dir, capture, analyze);
    expect(rows(service)).toEqual(beforeRestart);
    expect(
      service.db.prepare("SELECT * FROM events ORDER BY sequence").all(),
    ).toEqual(beforeEvents);
    expect(service.reference(middle.id)).toEqual(middle);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("updates an existing legacy row in place without rewriting untouched raw rows or restoring a guessed historical order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-legacy-position-"));
  let service = new ReferenceService(dir);
  try {
    const legacy = [
      "later timestamp first",
      "earlier timestamp second",
      "third",
    ].map((name, index) => ({
      ...input(name),
      id: randomUUID(),
      version: 7,
      accepted: [],
      legacyMarker: index,
      createdAt: index === 0 ? "2099" : "1970",
    }));
    for (const ref of legacy)
      service.db
        .prepare("INSERT INTO refs VALUES (?,?)")
        .run(ref.id, JSON.stringify(ref));
    const before = rows(service);
    const saved = service.update(legacy[1].id, 7, {
      ...input(legacy[1].name),
      likes: "explicit correction",
    });
    expect(saved.version).toBe(8);
    expect(saved).toHaveProperty("legacyMarker", 1);
    expect(
      rows(service).map((row) => ({ id: row.id, rowid: row.rowid })),
    ).toEqual(before.map((row) => ({ id: row.id, rowid: row.rowid })));
    expect(rows(service).filter((row) => row.id !== saved.id)).toEqual(
      before.filter((row) => row.id !== saved.id),
    );
    const after = rows(service);
    await service.close();
    service = new ReferenceService(dir);
    expect(rows(service)).toEqual(after);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("preserves unknown-order legacy job positions when an earlier active row is interrupted on restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-legacy-job-position-"));
  let service = new ReferenceService(dir);
  try {
    const ref = service.create(input("legacy job"));
    const active = {
      id: randomUUID(),
      referenceId: ref.id,
      input: ref,
      type: "capture",
      state: "running",
      createdAt: "old",
      updatedAt: "old",
      legacyMarker: "active",
    };
    const terminal = {
      ...active,
      id: randomUUID(),
      state: "failed",
      legacyMarker: "terminal",
    };
    for (const job of [active, terminal])
      service.db
        .prepare("INSERT INTO jobs VALUES (?,?)")
        .run(job.id, JSON.stringify(job));
    const before = service.db
      .prepare("SELECT rowid,id,data FROM jobs ORDER BY rowid")
      .all();
    const referenceRows = rows(service);
    await service.close();
    service = new ReferenceService(dir);
    expect(service.jobs().map((job) => job.id)).toEqual([
      active.id,
      terminal.id,
    ]);
    expect(service.jobs().map((job) => job.createdSequence)).toEqual([0, 0]);
    const after = service.db
      .prepare("SELECT rowid,id,data FROM jobs ORDER BY rowid")
      .all();
    expect(after.map((row) => ({ id: row.id, rowid: row.rowid }))).toEqual(
      before.map((row) => ({ id: row.id, rowid: row.rowid })),
    );
    expect(after[1]).toEqual(before[1]);
    expect(service.job(active.id)).toMatchObject({
      state: "interrupted",
      createdSequence: 0,
      transitionSequence: 1,
      legacyMarker: "active",
    });
    expect(rows(service)).toEqual(referenceRows);
  } finally {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
