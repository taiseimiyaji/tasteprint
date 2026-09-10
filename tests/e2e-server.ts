// Deterministic E2E server. This fixture is never imported by the production entrypoint.
import { serve } from "@hono/node-server";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { app } from "../src/server/app";
import { ReferenceService } from "../src/server/references/service";
import { referenceRoutes } from "../src/server/references/routes";
import { CaptureError } from "../src/server/capture/proxy";
const dir = mkdtempSync(join(tmpdir(), "tasteprint-e2e-"));
const service = new ReferenceService(
  dir,
  async () => {
    throw new CaptureError(
      "TIMEOUT",
      "30秒以内に取得できませんでした。画像アップロードで続行できます。",
    );
  },
  async (r) => ({
    referenceId: r.id,
    findings: [
      {
        aspect: "Typography",
        observation: "見出しが強調されている",
        interpretation: "情報階層を重視",
        recommendation: "見出しと本文の強弱を付ける",
        certainty: "medium",
        evidence: "画像上部の見出し",
      },
    ],
  }),
);
app.route(
  "/api/references",
  referenceRoutes(service, "e2e-pair-code", undefined, [3100, 3101]),
);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 3101 });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      void service.close().then(() => {
        rmSync(dir, { recursive: true, force: true });
        process.exit(0);
      });
    }),
  );
