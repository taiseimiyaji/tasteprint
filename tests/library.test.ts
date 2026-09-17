import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  defaultDesign,
  designSchema,
  designMarkdown,
} from "../src/domain/design";
import { FoundationService } from "../src/server/foundation/service";
import { emptyDecision } from "../src/domain/foundation";
const directory = mkdtempSync(join(tmpdir(), "library-"));
afterEach(() => rmSync(directory, { recursive: true, force: true }));
it("reads old immutable rows with defaults, persists the complete library, and restores after reopening SQLite", () => {
  const path = join(directory, "design.sqlite");
  let db = new DatabaseSync(path);
  try {
    let service = new FoundationService(db);
    const { components, patterns, ...legacy } = defaultDesign;
    db.prepare("INSERT INTO foundation_revisions(data) VALUES (?)").run(
      JSON.stringify({
        design: legacy,
        reason: "legacy",
        createdAt: "2026-01-01",
        schemaVersion: 2,
        decisions: [],
      }),
    );
    expect(service.current()?.design.components).toEqual(components);
    const design = structuredClone(defaultDesign);
    design.components.Button.size = "lg";
    design.components.Input.rules = "Keep labels visible";
    design.patterns.ListPage.gap = 32;
    design.patterns.PageHeader.structure.reverse();
    const saved = service.save(1, design, "library", randomUUID());
    expect(saved.decisions.map((d) => d.targetPath)).toEqual([
      "components",
      "patterns",
    ]);
    db.close();
    db = new DatabaseSync(path);
    service = new FoundationService(db);
    expect(service.current()?.design).toEqual(design);
    expect(designMarkdown(design, {}, [])).toContain("Keep labels visible");
    expect(service.restore(2, 1, randomUUID()).design).toEqual(defaultDesign);
    expect(
      JSON.parse(
        String(
          db
            .prepare("SELECT data FROM foundation_revisions WHERE revision=1")
            .get()!.data,
        ),
      ).design,
    ).not.toHaveProperty("components");
  } finally {
    db.close();
  }
});
it("rejects executable or unknown settings, impossible states and invalid structures/references", () => {
  for (const mutate of [
    (d: any) => (d.components.Button.tsx = "alert(1)"),
    (d: any) => (d.components.Button.variant = "url(https://bad)"),
    (d: any) => d.components.Badge.states.push("error"),
    (d: any) => (d.patterns.ListPage.structure = ["Table", "Table"]),
    (d: any) => (d.patterns.FilterBar.components = ["Unknown"]),
    (d: any) => (d.patterns.EmptyState.gap = -1),
  ]) {
    const d = structuredClone(defaultDesign);
    mutate(d);
    expect(designSchema.safeParse(d).success).toBe(false);
  }
});
it("proposals remain provisional; apply is idempotent, validates locks and rejects stale revisions", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const service = new FoundationService(db, async (design) => {
      const next = structuredClone(design);
      next.components.Button.variant = "subtle";
      next.patterns.ListPage.gap = 24;
      return {
        candidates: [{ design: next, explanation: "一覧に余白を追加" }],
      };
    });
    service.initialize();
    const signal = new AbortController().signal;
    const [first] = await service.propose(1, "adjust", signal);
    const [stale] = await service.propose(1, "adjust", signal);
    expect(service.current()?.revision).toBe(1);
    const applied = service.apply(first.id);
    expect(applied.revision).toBe(2);
    expect(applied.design.components.Button.variant).toBe("subtle");
    expect(service.apply(first.id)).toEqual(applied);
    expect(() => service.apply(stale.id)).toThrow(/更新/);
    const locked = structuredClone(defaultDesign);
    locked.constraints.components = { ...emptyDecision, locked: true };
    service.save(2, locked, "lock", randomUUID());
    await expect(service.propose(3, "adjust", signal)).rejects.toThrow(
      /ロック/,
    );
    expect(service.current()?.revision).toBe(3);
  } finally {
    db.close();
  }
});
