import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  analysisSchema,
  referenceInputSchema,
  type ReferenceInput,
  type SavedReference,
  type Job,
  type JobState,
} from "../../domain/reference";
import { capturePage, type CaptureResult } from "../capture/capture";
import { CaptureError, publicUrl } from "../capture/proxy";
import { CodexGateway, type Analyze } from "../codex/gateway";
export class ServiceError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 413 | 503,
    message: string,
  ) {
    super(message);
  }
}
const active = (job: Job) => job.state === "running" || job.state === "queued";
export class ReferenceService {
  readonly db: DatabaseSync;
  private controllers = new Map<string, AbortController>();
  private tasks = new Set<Promise<void>>();
  private stopped = false;
  constructor(
    readonly directory: string,
    private capture = capturePage,
    private analyze: Analyze = new CodexGateway().analyze,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    mkdirSync(join(directory, "assets"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "references.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS refs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
      PRAGMA user_version=1;`);
    for (const job of this.jobs().filter(active))
      this.transition(job, "interrupted", {
        code: "INTERRUPTED",
        message: "サーバーが再起動しました。手動で再試行してください。",
        retryable: true,
      });
  }
  private save(table: "refs" | "jobs", value: SavedReference | Job) {
    this.db
      .prepare(`INSERT OR REPLACE INTO ${table} VALUES (?, ?)`)
      .run(value.id, JSON.stringify(value));
  }
  references(): SavedReference[] {
    return this.db
      .prepare("SELECT data FROM refs ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  jobs(): Job[] {
    return this.db
      .prepare("SELECT data FROM jobs ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  reference(id: string) {
    const r = this.references().find((r) => r.id === id);
    if (!r) throw new ServiceError(404, "参考が見つかりません。");
    return r;
  }
  job(id: string) {
    const j = this.jobs().find((j) => j.id === id);
    if (!j) throw new ServiceError(404, "ジョブが見つかりません。");
    return j;
  }
  events(id: string, after: number) {
    this.job(id);
    return this.db
      .prepare(
        "SELECT sequence, state, created_at AS createdAt FROM events WHERE job_id = ? AND sequence > ? ORDER BY sequence",
      )
      .all(id, after);
  }
  create(input: ReferenceInput) {
    if (this.references().length >= 20)
      throw new ServiceError(413, "参考は20件まで登録できます。");
    const parsed = referenceInputSchema.parse(input);
    if (parsed.url) publicUrl(parsed.url);
    const reference: SavedReference = {
      ...parsed,
      id: randomUUID(),
      version: 1,
      accepted: [],
    };
    this.save("refs", reference);
    return reference;
  }
  update(id: string, version: number, input: ReferenceInput) {
    const old = this.reference(id);
    this.checkVersion(old, version);
    const parsed = referenceInputSchema.parse(input);
    if (parsed.url) publicUrl(parsed.url);
    const next: SavedReference = {
      ...old,
      ...parsed,
      version: old.version + 1,
      analysis: undefined,
      analysisJobId: undefined,
      accepted: [],
    };
    if (old.url !== parsed.url) {
      next.assetId = undefined;
      next.capture = undefined;
    }
    this.save("refs", next);
    return next;
  }
  remove(id: string, version: number) {
    this.checkVersion(this.reference(id), version);
    for (const job of this.jobs().filter(
      (j) => j.referenceId === id && active(j),
    ))
      this.cancel(job.id);
    this.db.prepare("DELETE FROM refs WHERE id = ?").run(id);
  }
  private checkVersion(reference: SavedReference, version: number) {
    if (reference.version !== version)
      throw new ServiceError(
        409,
        "参考が更新されています。最新の内容を確認してください。",
      );
  }
  assetPath(assetId: string) {
    if (!/^[a-f0-9-]{36}$/.test(assetId))
      throw new ServiceError(404, "画像が見つかりません。");
    return join(this.directory, "assets", `${assetId}.png`);
  }
  asset(id: string) {
    const reference = this.reference(id);
    if (!reference.assetId) throw new ServiceError(404, "画像がありません。");
    return readFileSync(this.assetPath(reference.assetId));
  }
  private saveAsset(image: Buffer) {
    const id = randomUUID();
    writeFileSync(this.assetPath(id), image, { mode: 0o600 });
    return id;
  }
  async upload(id: string, version: number, bytes: Buffer) {
    this.checkVersion(this.reference(id), version);
    if (bytes.length > 10 * 1024 * 1024)
      throw new ServiceError(413, "画像は10MB以下にしてください。");
    let image: Buffer;
    try {
      const pipeline = sharp(bytes, {
        limitInputPixels: 25_000_000,
        animated: false,
      });
      const meta = await pipeline.metadata();
      if (
        !["png", "jpeg", "webp"].includes(meta.format || "") ||
        (meta.pages ?? 1) > 1
      )
        throw new Error("Unsupported image");
      image = await pipeline.rotate().png().toBuffer();
    } catch {
      throw new ServiceError(
        400,
        "有効なPNG・JPEG・WebP画像を選んでください（最大2500万画素）。",
      );
    }
    const old = this.reference(id);
    this.checkVersion(old, version);
    const next: SavedReference = {
      ...old,
      assetId: this.saveAsset(image),
      version: version + 1,
      capture: undefined,
      analysis: undefined,
      analysisJobId: undefined,
      accepted: [],
    };
    this.save("refs", next);
    return next;
  }
  enqueue(id: string, version: number, type: Job["type"], key: string) {
    const previous = this.jobs().find((j) => j.id === key);
    if (previous) {
      if (
        previous.referenceId !== id ||
        previous.type !== type ||
        previous.input.version !== version
      )
        throw new ServiceError(409, "冪等キーが別の操作で使われています。");
      return previous;
    }
    const input = this.reference(id);
    this.checkVersion(input, version);
    if (this.stopped) throw new ServiceError(409, "サーバーを終了しています。");
    if (this.jobs().some((j) => j.referenceId === id && active(j)))
      throw new ServiceError(409, "この参考は処理中です。");
    if (type === "capture") {
      if (!input.url) throw new ServiceError(400, "URLを入力してください。");
      publicUrl(input.url);
    }
    if (type === "analyze" && !input.assetId)
      throw new ServiceError(
        400,
        "先にURLを取得するか画像をアップロードしてください。",
      );
    const now = new Date().toISOString();
    const job: Job = {
      id: key,
      referenceId: id,
      input,
      type,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.transition(job, "queued");
    this.pump();
    return job;
  }
  private transition(job: Job, state: JobState, error?: Job["error"]) {
    job.state = state;
    job.updatedAt = new Date().toISOString();
    job.error = error;
    this.save("jobs", job);
    this.db
      .prepare("INSERT INTO events(job_id,state,created_at) VALUES (?,?,?)")
      .run(job.id, state, job.updatedAt);
  }
  private pump() {
    if (this.stopped) return;
    for (const type of ["capture", "analyze"] as const) {
      if (
        this.jobs().some((j) => j.type === type && this.controllers.has(j.id))
      )
        continue;
      const job = this.jobs().find(
        (j) => j.type === type && j.state === "queued",
      );
      if (!job) continue;
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      this.transition(job, "running");
      const task = this.run(job, controller).finally(() => {
        this.controllers.delete(job.id);
        this.tasks.delete(task);
        this.pump();
      });
      this.tasks.add(task);
    }
  }
  private async run(job: Job, controller: AbortController) {
    const timer = setTimeout(
      () =>
        controller.abort(
          new CaptureError(
            "TIMEOUT",
            job.type === "capture"
              ? "30秒以内に取得できませんでした。画像アップロードで続行できます。"
              : "分析が5分でタイムアウトしました。",
          ),
        ),
      job.type === "capture" ? 30_000 : 300_000,
    );
    try {
      let captured: CaptureResult | undefined;
      let analysis: SavedReference["analysis"];
      if (job.type === "capture")
        captured = await this.capture(job.input.url, controller.signal);
      else {
        analysis = analysisSchema.parse(
          await this.analyze(
            job.input,
            this.assetPath(job.input.assetId!),
            controller.signal,
          ),
        );
        if (
          analysis.referenceId !== job.referenceId ||
          analysis.findings.some(
            (f) =>
              !job.input.selections.some((s) => s.aspect === f.aspect) ||
              (f.aspect === "Motion" && f.certainty !== "insufficient"),
          )
        )
          throw new CaptureError(
            "INVALID_ANALYSIS",
            "分析結果の観点・参照・根拠が入力と一致しません。",
          );
      }
      controller.signal.throwIfAborted();
      const reference = this.reference(job.referenceId);
      this.checkVersion(reference, job.input.version);
      const next: SavedReference = {
        ...reference,
        version: reference.version + 1,
        accepted: [],
        analysis,
        analysisJobId: analysis ? job.id : undefined,
      };
      if (captured) {
        next.assetId = this.saveAsset(captured.image);
        next.capture = captured.metadata;
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.save("refs", next);
        this.transition(job, "succeeded");
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    } catch (error) {
      if (controller.signal.aborted && this.job(job.id).state === "canceled")
        return;
      const cause = controller.signal.aborted
        ? controller.signal.reason
        : error;
      this.transition(job, "failed", {
        code:
          cause instanceof CaptureError
            ? cause.code
            : cause instanceof ServiceError
              ? "STALE_INPUT"
              : "JOB_FAILED",
        message:
          cause instanceof CaptureError || cause instanceof ServiceError
            ? cause.message
            : "処理に失敗しました。保存内容を確認して再試行してください。",
        retryable: !(
          cause instanceof CaptureError &&
          [
            "LOGIN_REQUIRED",
            "LIMIT_REACHED",
            "BLOCKED_ADDRESS",
            "INVALID_URL",
          ].includes(cause.code)
        ),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  cancel(id: string) {
    const job = this.job(id);
    if (!active(job)) return job;
    this.transition(job, "canceled");
    this.controllers.get(id)?.abort(new Error("Canceled"));
    return job;
  }
  accept(id: string, version: number, index: number) {
    const reference = this.reference(id);
    this.checkVersion(reference, version);
    if (!reference.analysis?.findings[index])
      throw new ServiceError(400, "分析項目が見つかりません。");
    if (!reference.accepted.includes(index)) {
      reference.accepted.push(index);
      reference.version++;
      this.save("refs", reference);
    }
    return reference;
  }
  async close() {
    this.stopped = true;
    for (const id of this.controllers.keys()) this.cancel(id);
    await Promise.allSettled(this.tasks);
    this.db.close();
  }
}
