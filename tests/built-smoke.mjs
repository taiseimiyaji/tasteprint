import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { unzipSync } from "fflate";
import sharp from "sharp";
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const directory = await mkdtemp(join(tmpdir(), "tasteprint-built-smoke-"));
const child = spawn(process.execPath, ["dist/server/index.js"], {
  env: { ...process.env, PORT: String(port), TASTEPRINT_DATA_DIR: directory },
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = new Promise((resolve) => child.once("exit", resolve));
const base = `http://127.0.0.1:${port}`;
let code = "",
  logs = "",
  ready = false;
child.stdout.on("data", (data) => {
  const text = data.toString();
  code ||= text.match(/接続コード: ([a-f0-9]+)/)?.[1] || "";
  if (text.includes(base)) ready = true;
});
child.stderr.on("data", (data) => {
  logs += data.toString();
});
try {
  for (let i = 0; i < 50 && !ready && child.exitCode === null; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert(ready, `Built server did not start: ${logs}`);
  assert.equal((await fetch(base + "/api/profile/references")).status, 401);
  const pair = await fetch(base + "/api/pair", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert(pair.ok, "Pairing failed");
  const headers = {
    Origin: base,
    "Content-Type": "application/json",
    Cookie: pair.headers.get("set-cookie").split(";")[0],
  };
  const created = await fetch(base + "/api/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ brief: { name: "Built smoke" }, useTaste: false }),
  });
  assert.equal(created.status, 201);
  const project = await created.json();
  const foundationPath = base + `/api/projects/${project.id}/foundation`;
  const initial = await fetch(foundationPath, { headers });
  assert.equal(initial.status, 200);
  const foundation = (await initial.json()).current;
  assert.equal(foundation.design.radius, 6);
  assert.equal(foundation.design.duration, 160);
  const saved = await fetch(foundationPath + "/save", {
    method: "POST",
    headers,
    body: JSON.stringify({
      baseRevision: foundation.revision,
      design: { ...foundation.design, duration: 80 },
      reason: "built smoke",
      requestId: crypto.randomUUID(),
    }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 2);
  const ref = await (
    await fetch(base + "/api/profile/references", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "blocked fixture",
        url: "http://127.0.0.1",
        selections: [{ aspect: "Typography", intent: "reference" }],
      }),
    })
  ).json();
  const started = await fetch(base + `/api/profile/references/${ref.id}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version: ref.version,
      type: "capture",
      key: crypto.randomUUID(),
    }),
  });
  assert.equal(started.status, 202);
  const job = await started.json();
  let result;
  for (let i = 0; i < 50; i++) {
    result = await (
      await fetch(base + `/api/profile/references/jobs/${job.id}`, { headers })
    ).json();
    if (result.job.state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(result.job.error?.code, "BLOCKED_ADDRESS");
  const html = await (await fetch(base + "/inspiration")).text();
  assert(html.includes('<div id="root">'), "SPA not served");
  const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  assert(
    (await fetch(base + asset)).headers
      .get("content-type")
      .includes("javascript"),
  );
  const exported = await fetch(base + `/api/projects/${project.id}/exports`, {
    method: "POST",
    headers,
    body: JSON.stringify({ baseRevision: 2, bundle: true }),
  });
  assert.equal(exported.status, 200, await exported.clone().text());
  const record = await exported.json();
  const zipName = Object.keys(record.files).find((n) => n.endsWith(".zip"));
  const downloaded = await fetch(
    base + `/api/projects/${project.id}/exports/${record.id}/${zipName}`,
    { headers },
  );
  assert.equal(downloaded.headers.get("content-type"), "application/zip");
  const entries = unzipSync(new Uint8Array(await downloaded.arrayBuffer()));
  const manifest = JSON.parse(
    Buffer.from(
      Object.entries(entries).find(([n]) => n.endsWith("/manifest.json"))[1],
    ).toString(),
  );
  assert.equal(manifest.revision, 2);
  assert.equal(manifest.images, "complete");
  const pngs = Object.entries(entries).filter(([n]) => n.endsWith(".png"));
  assert.equal(pngs.length, 3);
  for (const [, image] of pngs) {
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 1440);
    assert(metadata.height >= 1000);
  }
  assert(!Buffer.from(pngs[0][1]).equals(Buffer.from(pngs[1][1])));
  console.log(
    "Built server smoke passed: SPA/assets, session pairing, capture job, internal-address denial.",
  );
} finally {
  child.kill("SIGTERM");
  await exited;
  await rm(directory, { recursive: true, force: true });
}
