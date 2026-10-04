import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProjectService,
  type ExportRecord,
} from "../src/server/projects/service";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { briefSchema } from "../src/domain/projects";
import type { CaptureReview } from "../src/server/review/capture";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=",
  "base64",
);
const result = () => ({
  image: png,
  findings: [],
  verifiedRules: [],
  scope: [],
});
const fixtures: { dir: string; service: ProjectService }[] = [];
function setup(exportCapture: CaptureReview) {
  const dir = mkdtempSync(join(tmpdir(), "bundle-concurrency-"));
  const service = new ProjectService(dir, { exportCapture });
  fixtures.push({ dir, service });
  return service;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
function create(service: ProjectService, name = "Concurrent export") {
  return service.create(briefSchema.parse({ name }), false);
}
function design(record: ExportRecord) {
  return JSON.parse(record.files["design-system.json"]);
}
afterEach(async () => {
  for (const { dir, service } of fixtures.splice(0)) {
    await service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("returns the stored fast request ZIP and PNGs to a slower concurrent request", async () => {
  const started = gate(),
    slow = gate();
  const image = async (background: string) =>
    sharp({ create: { width: 1, height: 1, channels: 4, background } })
      .png()
      .toBuffer();
  const fastPng = await image("blue"),
    slowPng = await image("red");
  let calls = 0;
  const service = setup(async () => {
    const call = ++calls;
    if (call === 1) {
      started.release();
      await slow.promise;
    }
    return { ...result(), image: call === 1 || call > 4 ? slowPng : fastPng };
  });
  const p = create(service);
  const pending = service.exportBundle(p.id, 1);
  await started.promise;
  const fast = await service.exportBundle(p.id, 1);
  slow.release();
  const late = await pending;
  expect(calls).toBe(6);
  expect(late.id).toBe(fast.id);
  expect(late).toEqual(fast);
  expect(service.exports(p.id)).toEqual([fast]);
  for (const screen of ["list", "settings", "form"]) {
    expect(Buffer.from(late.files[`${screen}.png`], "base64")).toEqual(fastPng);
    expect(Buffer.from(late.files[`${screen}.png`], "base64")).not.toEqual(
      slowPng,
    );
  }
  const zipName = late.binaryFiles!.find((name) => name.endsWith(".zip"))!;
  const files = unzipSync(Buffer.from(late.files[zipName], "base64"));
  for (const screen of ["list", "settings", "form"])
    expect(
      Buffer.from(
        Object.entries(files).find(([name]) =>
          name.endsWith(`/examples/${screen}.png`),
        )![1],
      ),
    ).toEqual(fastPng);
  expect(await service.exportBundle(p.id, 1)).toEqual(fast);
  expect(calls).toBe(6);
  expect(service.revision(p.id).revision).toBe(1);
});
it("does not record concurrent failures and permits a later successful retry", async () => {
  const wait = gate();
  let fail = true;
  let calls = 0;
  const service = setup(async () => {
    if (++calls === 2) wait.release();
    await wait.promise;
    if (fail) throw new Error("Mock capture failure");
    return result();
  });
  const p = create(service);
  const outcomes = await Promise.allSettled([
    service.exportBundle(p.id, 1),
    service.exportBundle(p.id, 1),
  ]);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.reason.status).toBe(503);
  }
  expect(service.exports(p.id)).toEqual([]);
  fail = false;
  const saved = await service.exportBundle(p.id, 1);
  expect(calls).toBe(5);
  expect(service.exports(p.id)).toEqual([saved]);
  expect(await service.exportBundle(p.id, 1)).toEqual(saved);
});
it("reuses a successful concurrent record when the failed request is explicitly retried", async () => {
  const wait = gate();
  let calls = 0;
  const service = setup(async () => {
    const call = ++calls;
    if (call === 2) wait.release();
    await wait.promise;
    if (call === 1) throw new Error("One request fails");
    return result();
  });
  const p = create(service);
  const [failed, succeeded] = await Promise.allSettled([
    service.exportBundle(p.id, 1),
    service.exportBundle(p.id, 1),
  ]);
  expect(failed.status).toBe("rejected");
  expect(succeeded.status).toBe("fulfilled");
  if (succeeded.status !== "fulfilled") throw new Error("Expected success");
  expect(calls).toBe(4);
  expect(service.exports(p.id)).toEqual([succeeded.value]);
  expect(await service.exportBundle(p.id, 1)).toEqual(succeeded.value);
  expect(calls).toBe(4);
});
it("keeps project, revision and image mode conditions independent during concurrent capture", async () => {
  const wait = gate();
  let calls = 0;
  const seen: number[] = [];
  const service = setup(async (design) => {
    seen.push(design.radius);
    if (++calls === 3) wait.release();
    await wait.promise;
    return result();
  });
  const a = create(service, "First project"),
    b = create(service, "Second project");
  const f = service.scope(a.id).foundation;
  const first = f.current()!;
  f.save(
    1,
    { ...first.design, radius: 19 },
    "Second revision",
    crypto.randomUUID(),
  );
  const [a1, a2, b1, omitted] = await Promise.all([
    service.exportBundle(a.id, 1),
    service.exportBundle(a.id, 2),
    service.exportBundle(b.id, 1),
    service.exportBundle(a.id, 1, "omit"),
  ]);
  expect(new Set([a1.id, a2.id, b1.id, omitted.id]).size).toBe(4);
  expect(service.exports(a.id)).toHaveLength(3);
  expect(service.exports(b.id)).toEqual([b1]);
  expect(calls).toBe(9);
  expect(seen.filter((radius) => radius === 6)).toHaveLength(6);
  expect(seen.filter((radius) => radius === 19)).toHaveLength(3);
  expect(design(a1)).toMatchObject({
    projectId: a.id,
    revision: 1,
    design: { radius: 6 },
  });
  expect(design(a2)).toMatchObject({
    projectId: a.id,
    revision: 2,
    design: { radius: 19 },
  });
  expect(design(b1)).toMatchObject({
    projectId: b.id,
    revision: 1,
    design: { radius: 6 },
  });
  expect(omitted.imageMode).toBe("omit");
  expect(omitted.binaryFiles).toHaveLength(1);
  expect(await service.exportBundle(a.id, 1, "omit")).toEqual(omitted);
  expect(await service.exportBundle(a.id, 1)).toEqual(a1);
});
