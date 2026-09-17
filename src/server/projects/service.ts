import { bundleFiles, finishBundle, templateVersion } from "../exports/bundle";
import type { CaptureReview } from "../review/capture";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, existsSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ReferenceService, ServiceError } from "../references/service";
import {
  FoundationService,
  type Revision,
  type Generate,
} from "../foundation/service";
import { ReviewService, type ReviewAI } from "../review/service";
import { reviewCapture } from "../review/capture";
import { defaultDesign, profile, type Design } from "../../domain/design";
import { projectMarkdown } from "../../domain/project-export";
import { designCss } from "../../domain/tokens";
import {
  briefSchema,
  emptyTaste,
  tasteSchema,
  tasteDiff,
  mergeTaste,
  type Brief,
  type Principle,
  type ProjectSnapshot,
  type TasteRevision,
} from "../../domain/projects";
import { stateSchema } from "../../client/state";
import { aspects } from "../../domain/reference";

type Scope = {
  references: ReferenceService;
  foundation: FoundationService;
  reviews: ReviewService;
};
export type Project = {
  id: string;
  slug: string;
  createdAt: string;
  archivedAt: string | null;
  activeRevision: number;
  updatedAt: string;
  brief: Brief;
  latestExport: ExportRecord | null;
};
export type ExportRecord = {
  id: string;
  projectId: string;
  revision: number;
  sourceTasteProfileRevision: number | null;
  createdAt: string;
  files: Record<string, string>;
  binaryFiles?: string[];
  templateVersion?: string;
  imageMode?: "include" | "omit";
};
export type Dependencies = {
  referenceFactory?: (dir: string) => ReferenceService;
  generate?: Generate;
  reviewAI?: ReviewAI;
  previewOrigin?: string;
  exportCapture?: CaptureReview;
};
export class ProjectService {
  readonly db: DatabaseSync;
  private scopes = new Map<string, Scope>();
  readonly shared: ReferenceService;
  constructor(
    readonly directory: string,
    private dependencies: Dependencies = {},
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Back up a consistent SQLite image (including WAL) before any legacy service opens it.
    const old = join(directory, "references.sqlite"),
      backup = join(directory, "backup-before-projects");
    if (existsSync(old) && !existsSync(join(backup, "complete"))) {
      mkdirSync(backup, { recursive: true, mode: 0o700 });
      if (!existsSync(join(backup, "references.sqlite"))) {
        const db = new DatabaseSync(old);
        try {
          db.exec(
            `VACUUM INTO '${join(backup, "references.sqlite").replaceAll("'", "''")}'`,
          );
        } finally {
          db.close();
        }
      }
      if (existsSync(join(directory, "assets")))
        cpSync(join(directory, "assets"), join(backup, "assets"), {
          recursive: true,
        });
      writeFileSync(
        join(backup, "complete"),
        "SQLite and assets backed up before migration",
        { mode: 0o600 },
      );
    }
    this.db = new DatabaseSync(join(directory, "workspace.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, slug TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT);
      CREATE TABLE IF NOT EXISTS taste_revisions(revision INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migrations(id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    this.shared = this.makeReferences(join(directory, "profile"));
    if (!this.profileHistory().length)
      this.db.prepare("INSERT INTO taste_revisions(data) VALUES (?)").run(
        JSON.stringify({
          createdAt: new Date().toISOString(),
          snapshot: emptyTaste(),
        }),
      );
    if (existsSync(old) && !this.migration("sqlite-v1")) {
      const id = "legacy",
        target = join(directory, "projects", id);
      mkdirSync(target, { recursive: true, mode: 0o700 });
      cpSync(
        join(backup, "references.sqlite"),
        join(target, "references.sqlite"),
      );
      if (existsSync(join(backup, "assets")))
        cpSync(join(backup, "assets"), join(target, "assets"), {
          recursive: true,
        });
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare("INSERT OR IGNORE INTO projects VALUES (?,?,?,NULL)")
          .run(id, "personal-workspace", new Date().toISOString());
        this.markMigration("sqlite-v1", { projectId: id, backup });
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
      this.scope(id); // Recover jobs only in their migrated owner database.
    }
  }
  private makeReferences(dir: string) {
    return (
      this.dependencies.referenceFactory?.(dir) ?? new ReferenceService(dir)
    );
  }
  private migration(id: string) {
    return this.db.prepare("SELECT data FROM migrations WHERE id=?").get(id);
  }
  private markMigration(id: string, data: unknown) {
    this.db
      .prepare("INSERT INTO migrations VALUES (?,?)")
      .run(id, JSON.stringify(data));
  }
  profileHistory(): TasteRevision[] {
    return this.db
      .prepare("SELECT revision,data FROM taste_revisions ORDER BY revision")
      .all()
      .map((r) => ({
        ...JSON.parse(String(r.data)),
        revision: Number(r.revision),
      }));
  }
  taste() {
    return this.profileHistory().at(-1)!;
  }
  freezeReferences(service: ReferenceService) {
    return service.references().map((r) => ({
      ...r,
      analysis: r.analysis
        ? {
            ...r.analysis,
            findings: r.accepted.map((i) => r.analysis!.findings[i]),
          }
        : undefined,
      accepted: r.accepted.map((_, i) => i),
      ...(r.assetId
        ? {
            image: `data:image/png;base64,${service.asset(r.id).toString("base64")}`,
          }
        : {}),
    }));
  }
  saveTaste(base: number, input: z.infer<typeof tasteSchema>) {
    const parsed = tasteSchema.parse(input);
    if (base !== this.taste().revision)
      throw new ServiceError(
        409,
        "共通の好みが更新されています。再読み込みして差分を確認してください。",
      );
    const snapshot = {
      ...emptyTaste(),
      ...parsed,
      dna: profile(parsed.answers),
      references: this.freezeReferences(this.shared),
      confirmed: true,
    };
    const data = { snapshot, createdAt: new Date().toISOString() };
    const row = this.db
      .prepare(
        "INSERT INTO taste_revisions(data) SELECT ? WHERE (SELECT MAX(revision) FROM taste_revisions)=?",
      )
      .run(JSON.stringify(data), base);
    if (!row.changes)
      throw new ServiceError(
        409,
        "共通の好みが更新されています。差分を再確認してください。",
      );
    return { ...data, revision: Number(row.lastInsertRowid) };
  }
  private row(id: string) {
    if (!/^(legacy|[a-f0-9-]{36})$/.test(id))
      throw new ServiceError(404, "プロジェクトが見つかりません。");
    const row = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    if (!row) throw new ServiceError(404, "プロジェクトが見つかりません。");
    return row;
  }
  writable(id: string) {
    if (this.row(id).archived_at)
      throw new ServiceError(
        409,
        "アーカイブ中です。解除してから変更してください。",
      );
  }
  scope(id: string): Scope {
    this.row(id);
    const old = this.scopes.get(id);
    if (old) return old;
    const references = this.makeReferences(
      join(this.directory, "projects", id),
    );
    const foundation = new FoundationService(
      references.db,
      this.dependencies.generate,
    );
    references.db.exec(
      "CREATE TABLE IF NOT EXISTS project_snapshots(revision INTEGER PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS browser_imports(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    // Preserve historical Foundation rows byte-for-byte; attach migration snapshots by revision.
    const history = foundation.history();
    for (const rev of history)
      if (!rev.snapshot) {
        references.db
          .prepare("INSERT OR IGNORE INTO project_snapshots VALUES (?,?)")
          .run(
            rev.revision,
            JSON.stringify({
              ...this.initialSnapshot(
                id,
                briefSchema.parse({ name: "Personal workspace" }),
                false,
              ),
              taste: { ...emptyTaste(), dna: rev.dna ?? emptyTaste().dna },
              references: this.freezeReferences(references),
            }),
          );
      }
    foundation.enrichRevision = (r) => {
      const row = references.db
        .prepare("SELECT data FROM project_snapshots WHERE revision=?")
        .get(r.revision);
      return r.snapshot
        ? r
        : { ...r, snapshot: row ? JSON.parse(String(row.data)) : undefined };
    };
    foundation.protectedFields = () =>
      this.snapshot(id).policies.map((p) => p.target);
    foundation.snapshotProvider = () => ({
      ...this.snapshot(id),
      references: this.freezeReferences(references),
    });
    foundation.beforeWrite = () => this.writable(id);
    const reviews = new ReviewService(
      foundation,
      reviewCapture(this.dependencies.previewOrigin ?? "http://127.0.0.1:3000"),
      this.dependencies.reviewAI,
    );
    const scope = { references, foundation, reviews };
    this.scopes.set(id, scope);
    if (!history.length) {
      const snapshot = this.initialSnapshot(
        id,
        briefSchema.parse({ name: "Personal workspace" }),
        false,
      );
      foundation.snapshotProvider = () => snapshot;
      foundation.initialize();
      foundation.snapshotProvider = () => this.snapshotForSave(id);
    }
    return scope;
  }
  private initialSnapshot(
    id: string,
    brief: Brief,
    useTaste: boolean,
  ): ProjectSnapshot {
    return {
      projectId: id,
      brief,
      sourceTasteProfileRevision: useTaste ? this.taste().revision : null,
      taste: useTaste ? structuredClone(this.taste().snapshot) : emptyTaste(),
      policies: [],
      references: [],
      maintained: [],
    };
  }
  revision(
    id: string,
    revision?: number,
  ): Revision & { snapshot: ProjectSnapshot } {
    const scope = this.scope(id),
      r =
        revision === undefined
          ? scope.foundation.current()
          : scope.foundation.history().find((r) => r.revision === revision);
    if (!r) throw new ServiceError(404, "revisionが見つかりません。");
    const fallback = scope.references.db
      .prepare("SELECT data FROM project_snapshots WHERE revision=?")
      .get(r.revision);
    return { ...r, snapshot: r.snapshot ?? JSON.parse(String(fallback?.data)) };
  }
  snapshot(id: string) {
    return this.revision(id).snapshot;
  }
  private snapshotForSave(id: string) {
    return {
      ...this.snapshot(id),
      references: this.freezeReferences(this.scope(id).references),
    };
  }
  base(id: string, base: number) {
    this.writable(id);
    const r = this.revision(id);
    if (r.revision !== base)
      throw new ServiceError(
        409,
        "プロジェクトが更新されています。再読み込みして再試行してください。",
      );
    return r;
  }
  create(brief: Brief, useTaste = true, source?: number) {
    brief = briefSchema.parse(brief);
    if (useTaste && source !== this.taste().revision)
      throw new ServiceError(
        409,
        "共通の好みの版が変わりました。作成内容を確認してください。",
      );
    const id = randomUUID(),
      slug =
        (brief.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "project") +
        "-" +
        id.slice(0, 8);
    this.db
      .prepare("INSERT INTO projects VALUES (?,?,?,NULL)")
      .run(id, slug, new Date().toISOString());
    const scope = this.scope(id),
      snapshot = this.initialSnapshot(id, brief, useTaste);
    // Replace bootstrap only before the project is exposed; initial revision remains r1.
    const r = scope.foundation.current()!;
    scope.references.db
      .prepare("UPDATE foundation_revisions SET data=? WHERE revision=?")
      .run(
        JSON.stringify({
          ...r,
          snapshot,
          dna: snapshot.taste.dna,
        }),
        r.revision,
      );
    return this.project(id);
  }
  project(id: string): Project {
    const row = this.row(id),
      r = this.revision(id);
    return {
      id,
      slug: String(row.slug),
      createdAt: String(row.created_at),
      archivedAt: row.archived_at as string | null,
      activeRevision: r.revision,
      updatedAt: r.createdAt,
      brief: r.snapshot.brief,
      latestExport: this.exportSummaries(id)[0] ?? null,
    };
  }
  list() {
    return this.db
      .prepare("SELECT id FROM projects ORDER BY created_at DESC")
      .all()
      .map((r) => this.project(String(r.id)));
  }
  archive(id: string, base: number, archived: boolean) {
    const r = this.revision(id);
    if (r.revision !== base) throw new ServiceError(409, "古いrevisionです。");
    this.db
      .prepare("UPDATE projects SET archived_at=? WHERE id=?")
      .run(archived ? new Date().toISOString() : null, id);
    return this.project(id);
  }
  private commit(
    id: string,
    base: number,
    snapshot: ProjectSnapshot,
    reason: string,
    design?: Design,
  ) {
    const scope = this.scope(id);
    const r = this.base(id, base);
    scope.foundation.snapshotProvider = () => snapshot;
    try {
      return scope.foundation.save(
        base,
        design ?? r.design,
        reason,
        randomUUID(),
        snapshot.taste.dna,
      );
    } finally {
      scope.foundation.snapshotProvider = () => this.snapshotForSave(id);
    }
  }
  saveProject(id: string, base: number, brief: Brief, policies: Principle[]) {
    const r = this.base(id, base);
    const duplicate = policies.find((p, i) =>
      policies.some(
        (q, j) => j < i && q.target === p.target && q.text !== p.text,
      ),
    );
    if (duplicate)
      throw new ServiceError(
        409,
        `${duplicate.target} の明示指定が矛盾しています。原則を一つに整理してください。`,
      );
    return this.commit(
      id,
      base,
      {
        ...r.snapshot,
        brief: briefSchema.parse(brief),
        policies,
        references: this.freezeReferences(this.scope(id).references),
      },
      "プロジェクト概要・固有方針を保存",
    );
  }
  diff(id: string) {
    const r = this.revision(id);
    return {
      baseRevision: r.revision,
      baseProfileRevision: this.taste().revision,
      changes: tasteDiff(
        r.snapshot,
        this.taste().snapshot,
        r.design.constraints,
      ),
    };
  }
  adopt(
    id: string,
    base: number,
    profileBase: number,
    choices: Record<string, "adopt" | "keep">,
  ) {
    const r = this.base(id, base),
      latest = this.taste();
    if (latest.revision !== profileBase)
      throw new ServiceError(
        409,
        "共通の好みが更新されています。差分を再確認してください。",
      );
    const changes = this.diff(id).changes;
    if (
      Object.keys(choices).length !== changes.length ||
      changes.some((c) => !choices[c.key])
    )
      throw new ServiceError(
        400,
        "すべての差分で取り込み・維持を選んでください。",
      );
    if (changes.some((c) => c.conflict && choices[c.key] === "adopt"))
      throw new ServiceError(
        409,
        "固有指定・ロックとの競合があります。維持するか、固有指定を明示的に解消してください。",
      );
    const selected = changes
      .filter((c) => choices[c.key] === "adopt")
      .map((c) => c.key);
    return this.commit(
      id,
      base,
      {
        ...r.snapshot,
        sourceTasteProfileRevision: latest.revision,
        taste: mergeTaste(r.snapshot.taste, latest.snapshot, selected),
        maintained: [
          ...r.snapshot.maintained.filter(
            (m) => !changes.some((c) => c.key === m.key),
          ),
          ...changes
            .filter((c) => choices[c.key] === "keep")
            .map((c) => ({
              key: c.key,
              reason:
                c.conflict ??
                `共通 r${latest.revision} の変更を採用せず、プロジェクト固有の方針として維持`,
            })),
        ],
      },
      "共通の好みの差分を確認・確定",
    );
  }
  promote(id: string, base: number, profileBase: number, ids: string[]) {
    const r = this.base(id, base);
    const selected = r.snapshot.policies.filter((p) => ids.includes(p.id));
    if (!ids.length || selected.length !== new Set(ids).size)
      throw new ServiceError(400, "追加する固有原則を選んでください。");
    const taste = this.taste();
    return this.saveTaste(profileBase, {
      ...taste.snapshot,
      principles: [
        ...taste.snapshot.principles.filter(
          (p) => !selected.some((s) => s.id === p.id),
        ),
        ...selected,
      ],
    });
  }
  conversations(id: string) {
    return this.scope(id)
      .references.db.prepare("SELECT data FROM conversations ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  addConversation(id: string, base: number, text: string) {
    this.base(id, base);
    const value = {
      id: randomUUID(),
      projectId: id,
      baseRevision: base,
      text,
      createdAt: new Date().toISOString(),
    };
    this.scope(id)
      .references.db.prepare("INSERT INTO conversations VALUES (?,?)")
      .run(value.id, JSON.stringify(value));
    return value;
  }
  exportSummaries(id: string) {
    return this.exports(id).map((r) => ({
      ...r,
      files: Object.fromEntries(Object.keys(r.files).map((name) => [name, ""])),
    }));
  }
  exports(id: string): ExportRecord[] {
    return this.scope(id)
      .references.db.prepare("SELECT data FROM exports ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  export(id: string, base: number) {
    const r = this.revision(id, base),
      row = this.row(id),
      s = r.snapshot;
    const existing = this.exports(id).find(
      (e) => e.revision === base && !e.templateVersion,
    );
    if (existing) return existing;
    this.writable(id);
    const metadata = {
      projectId: id,
      revision: base,
      sourceTasteProfileRevision: s.sourceTasteProfileRevision,
    };
    const prefix = `${row.slug}-r${base}`;
    const files = {
      [`${prefix}-DESIGN.md`]: projectMarkdown(r),
      [`${prefix}-design-system.json`]: JSON.stringify(
        { ...metadata, design: r.design, snapshot: s, decisions: r.decisions },
        null,
        2,
      ),
      [`${prefix}-variables.css`]: `/* ${JSON.stringify(metadata)} */\n${designCss(r.design)}`,
    };
    const record: ExportRecord = {
      ...metadata,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      files,
    };
    this.scope(id)
      .references.db.prepare("INSERT INTO exports VALUES (?,?)")
      .run(record.id, JSON.stringify(record));
    return record;
  }
  async exportBundle(
    id: string,
    base: number,
    imageMode: "include" | "omit" = "include",
  ) {
    this.writable(id);
    const snapshot = structuredClone(this.revision(id, base));
    const existing = this.exports(id).find(
      (e) =>
        e.revision === base &&
        e.templateVersion === templateVersion &&
        e.imageMode === imageMode,
    );
    if (existing) return existing;
    const { files, metadata } = bundleFiles(snapshot);
    const images: Record<string, Buffer> = {};
    if (imageMode === "include") {
      const capture =
        this.dependencies.exportCapture ??
        reviewCapture(
          this.dependencies.previewOrigin ?? "http://127.0.0.1:3000",
          1440,
          false,
        );
      try {
        for (const screen of ["list", "settings", "form"]) {
          const result = await capture(
            structuredClone(snapshot.design),
            screen,
            AbortSignal.timeout(60000),
          );
          if (
            !result.image
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          )
            throw new Error("Invalid PNG");
          images[`${screen}.png`] = result.image;
        }
      } catch {
        throw new ServiceError(
          503,
          "PNG の生成に失敗しました。再試行、または「画像なし ZIP」を選択してください。成果物は保存していません。",
        );
      }
    }
    const root = `tasteprint-${this.row(id).slug}-r${base}`;
    const bundle = finishBundle(
      files,
      metadata,
      Object.fromEntries(
        Object.entries(images).map(([n, v]) => [`examples/${n}`, v]),
      ),
      root,
    );
    const binaryFiles = [...Object.keys(images), `${root}.zip`];
    // Flat download names; ZIP retains the portable directory layout.
    const downloads = Object.fromEntries(
      Object.entries(bundle.files).map(([name, value]) => [
        name.replaceAll("/", "--"),
        value,
      ]),
    );
    for (const [name, image] of Object.entries(images))
      downloads[name] = image.toString("base64");
    downloads[`${root}.zip`] = bundle.zip.toString("base64");
    const record: ExportRecord = {
      id: randomUUID(),
      projectId: id,
      revision: base,
      sourceTasteProfileRevision: snapshot.snapshot.sourceTasteProfileRevision,
      createdAt: new Date().toISOString(),
      files: downloads,
      binaryFiles,
      templateVersion,
      imageMode,
    };
    this.scope(id)
      .references.db.prepare("INSERT INTO exports VALUES (?,?)")
      .run(record.id, JSON.stringify(record));
    return record;
  }
  async importBrowser(raw: unknown) {
    const serialized = JSON.stringify(raw),
      key = "browser-" + createHash("sha256").update(serialized).digest("hex");
    const done = this.migration(key);
    if (done) return JSON.parse(String(done.data));
    const state = stateSchema.parse(raw);
    const backup = join(this.directory, "backup-before-projects");
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    writeFileSync(join(backup, `${key}.json`), serialized, { mode: 0o600 });
    let id = "legacy";
    if (!this.db.prepare("SELECT id FROM projects WHERE id='legacy'").get()) {
      this.db
        .prepare(
          "INSERT INTO projects VALUES ('legacy','personal-workspace',?,NULL)",
        )
        .run(new Date().toISOString());
    }
    const scope = this.scope(id),
      prior = scope.references.db
        .prepare("SELECT data FROM browser_imports WHERE id=?")
        .get(key);
    if (!prior) {
      // Original localStorage JSON is retained as well as parsed design and references.
      const r = this.revision(id),
        s = {
          ...r.snapshot,
          taste: {
            ...r.snapshot.taste,
            answers: state.answers,
            dna: profile(state.answers),
            confirmed: Object.keys(state.answers).length > 0,
          },
        };
      const isPristine =
        r.revision === 1 &&
        r.reason === "既存Foundationを移行" &&
        JSON.stringify(r.design) === JSON.stringify(defaultDesign) &&
        !this.migration("sqlite-v1");
      scope.references.db.exec("BEGIN IMMEDIATE");
      try {
        for (const old of state.references.filter(
          (r) => !["linear", "stripe", "vercel"].includes(r.id),
        )) {
          const importedId = createHash("sha256")
            .update(old.id)
            .digest("hex")
            .slice(0, 32)
            .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
          if (
            scope.references
              .references()
              .some(
                (r) =>
                  r.id === old.id ||
                  r.id === importedId ||
                  (r.url && r.url === old.url),
              )
          )
            continue;
          const image = old.image?.match(
            /^data:image\/(png|jpeg|webp);base64,(.+)$/,
          );
          let assetId: string | undefined;
          if (image) {
            assetId = randomUUID();
            writeFileSync(
              scope.references.assetPath(assetId),
              Buffer.from(image[2], "base64"),
              { mode: 0o600 },
            );
          }
          const ref = {
            id: importedId,
            name: old.name,
            url: old.url,
            version: 1,
            selections: old.aspects
              .filter((a) => aspects.includes(a as (typeof aspects)[number]))
              .map((aspect) => ({ aspect, intent: "reference" })),
            likes: "",
            dislikes: "",
            accepted: (old.principles ?? []).map((_, i) => i),
            ...(old.principles
              ? {
                  analysis: {
                    referenceId: importedId,
                    findings: old.principles,
                  },
                }
              : {}),
            assetId,
          };
          scope.references.db
            .prepare("INSERT INTO refs VALUES (?,?)")
            .run(importedId, JSON.stringify(ref));
        }
        s.references = this.freezeReferences(scope.references);
        const value = {
          ...r,
          revision: undefined,
          design: isPristine ? state.design : r.design,
          snapshot: s,
          dna: profile(state.answers),
          reason: "ブラウザ保存内容の移行（旧SQLiteの確定値を優先）",
          createdAt: new Date().toISOString(),
        };
        scope.references.db
          .prepare("INSERT INTO foundation_revisions(data) VALUES (?)")
          .run(JSON.stringify(value));
        scope.references.db
          .prepare("INSERT INTO browser_imports VALUES (?,?)")
          .run(key, serialized);
        scope.references.db.exec("COMMIT");
      } catch (e) {
        scope.references.db.exec("ROLLBACK");
        throw e;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const taste = this.taste();
      if (!taste.snapshot.confirmed && Object.keys(state.answers).length)
        this.saveTaste(taste.revision, {
          answers: state.answers,
          reasons: {},
          principles: [],
        });
      const result = { projectId: id, backup: key };
      this.markMigration(key, result);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async close() {
    await Promise.all(
      [...this.scopes.values()].map((s) => s.references.close()),
    );
    await this.shared.close();
    this.db.close();
  }
}
