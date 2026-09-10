import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
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
  assert.equal((await fetch(base + "/api/references")).status, 401);
  const pair = await fetch(base + "/api/references/pair", {
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
  const foundationPath = base + "/api/references/foundation";
  const initial = await fetch(foundationPath, { headers });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).current, null);
  const imported = await fetch(foundationPath + "/initialize", {
    method: "POST",
    headers,
    body: JSON.stringify({
      design: {
        accent: "#123456",
        radius: 12,
        spacing: 16,
        fontSize: 14,
        border: true,
        shadow: false,
      },
    }),
  });
  assert.equal(imported.status, 200);
  const foundation = await imported.json();
  assert.equal(foundation.design.radius, 12);
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
    await fetch(base + "/api/references", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "blocked fixture",
        url: "http://127.0.0.1",
        selections: [{ aspect: "Typography", intent: "reference" }],
      }),
    })
  ).json();
  const started = await fetch(base + `/api/references/${ref.id}/jobs`, {
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
      await fetch(base + `/api/references/jobs/${job.id}`, { headers })
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
  console.log(
    "Built server smoke passed: SPA/assets, session pairing, capture job, internal-address denial.",
  );
} finally {
  child.kill("SIGTERM");
  await exited;
  await rm(directory, { recursive: true, force: true });
}
