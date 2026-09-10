import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ReferenceService } from "../src/server/references/service";
import { referenceRoutes } from "../src/server/references/routes";
import { buildAnalysisPrompt } from "../src/server/codex/gateway";
import type { Analysis } from "../src/domain/reference";
const dirs: string[] = [];
const services: ReferenceService[] = [];
const input = {
  name: "Example",
  url: "https://example.com",
  selections: [{ aspect: "Density" as const, intent: "avoid" as const }],
  likes: "余白",
  dislikes: "密すぎる行",
};
const metadata = {
  capturedAt: new Date().toISOString(),
  finalUrl: input.url,
  viewport: { width: 1440, height: 1000 },
  structure: { title: "Example", headings: [], landmarks: {}, controls: {} },
};
function setup(
  capture = vi.fn(async () => ({ image: Buffer.from("test"), metadata })),
  analyze = vi.fn(async (r: { id: string }): Promise<Analysis> => ({
    referenceId: r.id,
    findings: [
      {
        aspect: "Density",
        observation: "行が密",
        interpretation: "一覧性を優先",
        recommendation: "余白を広げる",
        certainty: "medium",
        evidence: "中央の一覧",
      },
    ],
  })),
) {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-test-"));
  dirs.push(dir);
  const service = new ReferenceService(dir, capture, analyze);
  services.push(service);
  return { service, capture, analyze, dir };
}
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function settled(service: ReferenceService, id: string) {
  await vi.waitFor(() =>
    expect(["queued", "running"]).not.toContain(service.job(id).state),
  );
  return service.job(id);
}
describe("persistent reference jobs", () => {
  it("snapshots selected aspects, notes, image and structure; applies only accepted findings", async () => {
    const { service, analyze } = setup();
    const ref = service.create(input);
    const job = service.enqueue(ref.id, ref.version, "capture", randomUUID());
    await settled(service, job.id);
    const captured = service.reference(ref.id);
    expect(captured.capture).toEqual(metadata);
    const analysis = service.enqueue(
      ref.id,
      captured.version,
      "analyze",
      randomUUID(),
    );
    await settled(service, analysis.id);
    const result = service.reference(ref.id);
    expect(result.accepted).toEqual([]);
    expect(result.analysis?.findings).toHaveLength(1);
    expect(analyze.mock.calls[0][0]).toMatchObject({
      ...input,
      capture: metadata,
      assetId: captured.assetId,
    });
    expect(buildAnalysisPrompt(result)).toContain("密すぎる行");
    expect(service.accept(ref.id, result.version, 0).accepted).toEqual([0]);
    expect(service.events(job.id, 0).map((e) => e.state)).toEqual([
      "queued",
      "running",
      "succeeded",
    ]);
  });
  it("deduplicates requests and refuses stale results and adoption", async () => {
    let finish!: (value: {
      image: Buffer<ArrayBuffer>;
      metadata: typeof metadata;
    }) => void;
    const { service } = setup(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const ref = service.create(input);
    const key = randomUUID();
    const job = service.enqueue(ref.id, 1, "capture", key);
    expect(service.enqueue(ref.id, 1, "capture", key).id).toBe(job.id);
    service.update(ref.id, 1, { ...input, likes: "更新後" });
    finish({ image: Buffer.from("x"), metadata });
    expect((await settled(service, job.id)).error?.code).toBe("STALE_INPUT");
    expect(service.reference(ref.id).assetId).toBeUndefined();
    expect(() => service.accept(ref.id, 1, 0)).toThrow("更新");
  });
  it("holds the capture slot until cancellation has actually settled, and ignores late output", async () => {
    const finish: (() => void)[] = [];
    const { service, capture } = setup(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish.push(() => resolve({ image: Buffer.from("x"), metadata }));
          }),
      ),
    );
    const a = service.create(input),
      b = service.create(input);
    const first = service.enqueue(a.id, 1, "capture", randomUUID());
    const second = service.enqueue(b.id, 1, "capture", randomUUID());
    service.cancel(first.id);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(service.job(second.id).state).toBe("queued");
    finish[0]();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    expect(service.reference(a.id).assetId).toBeUndefined();
    finish[1]();
    await settled(service, second.id);
  });
  it("marks running and queued work interrupted on restart and preserves references", async () => {
    const { service, dir } = setup();
    const ref = service.create(input);
    const job = {
      id: randomUUID(),
      referenceId: ref.id,
      input: ref,
      type: "capture",
      state: "running",
      createdAt: "now",
      updatedAt: "now",
    };
    service.db
      .prepare("INSERT INTO jobs VALUES (?,?)")
      .run(job.id, JSON.stringify(job));
    service.db
      .prepare("INSERT INTO jobs VALUES (?,?)")
      .run("queued", JSON.stringify({ ...job, id: "queued", state: "queued" }));
    await service.close();
    services.splice(services.indexOf(service), 1);
    const restarted = new ReferenceService(dir);
    services.push(restarted);
    expect(restarted.references()).toHaveLength(1);
    expect(restarted.jobs().map((j) => j.state)).toEqual([
      "interrupted",
      "interrupted",
    ]);
  });
  it("validates image bytes and stores a re-encoded PNG fallback", async () => {
    const { service } = setup();
    const ref = service.create(input);
    await expect(
      service.upload(ref.id, 1, Buffer.from('<svg onload="bad()"/>')),
    ).rejects.toThrow("有効なPNG");
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await service.upload(ref.id, 1, png);
    expect(uploaded.capture).toBeUndefined();
    expect(service.asset(ref.id).subarray(1, 4).toString()).toBe("PNG");
  });
  it("guards session, host, origin, ownership and analysis consent", async () => {
    const { service } = setup();
    const routes = referenceRoutes(service, "test-code");
    const url = "http://127.0.0.1:3000";
    expect((await routes.request(url + "/")).status).toBe(401);
    expect((await routes.request("http://evil.test:3000/")).status).toBe(403);
    expect(
      (
        await routes.request(url + "/pair", {
          method: "POST",
          headers: {
            origin: "http://evil.test",
            "Content-Type": "application/json",
          },
          body: '{"code":"test-code"}',
        })
      ).status,
    ).toBe(403);
    const response = await routes.request(url + "/pair", {
      method: "POST",
      headers: { origin: url, "Content-Type": "application/json" },
      body: '{"code":"test-code"}',
    });
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    expect(cookie).toContain("tasteprint_session=");
    const headers = { cookie, origin: url, "Content-Type": "application/json" };
    expect((await routes.request(url + "/", { headers })).status).toBe(200);
    const ref = service.create(input);
    expect(
      (
        await routes.request(url + `/${ref.id}/jobs`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            version: 1,
            type: "analyze",
            key: randomUUID(),
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await routes.request(url + "/missing/image", { headers })).status,
    ).toBe(404);
  });
});
