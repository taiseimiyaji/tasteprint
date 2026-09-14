// Deterministic E2E server. This fixture is never imported by the production entrypoint.
import { serve } from "@hono/node-server";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FoundationService } from "../src/server/foundation/service";
import { app } from "../src/server/app";
import { ReferenceService } from "../src/server/references/service";
import { referenceRoutes } from "../src/server/references/routes";
import { CaptureError } from "../src/server/capture/proxy";
import { ReviewService } from "../src/server/review/service";
import { reviewCapture } from "../src/server/review/capture";
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
const foundation = new FoundationService(service.db, async (design) => ({
  candidates: [
    {
      design: {
        ...design,
        radius: design.constraints.radius?.locked ? design.radius : 4,
      },
      explanation: "角丸を小さくします",
    },
    {
      design: {
        ...design,
        radius: design.constraints.radius?.locked ? design.radius : 2,
      },
      explanation: "直線的に整えます",
    },
  ],
}));
app.route(
  "/api/references",
  referenceRoutes(
    service,
    "e2e-pair-code",
    undefined,
    [3100, 3101],
    foundation,
    new ReviewService(
      foundation,
      reviewCapture("http://127.0.0.1:3100"),
      async () => ({
        findings: [
          {
            ruleId: "visual-hierarchy",
            targetPath: "list:heading",
            severity: "warning",
            evidence: "見出しと本文の強弱が小さい",
            explanation: "情報階層を確認",
            suggestedChange: "見出しを強調",
          },
        ],
      }),
    ),
  ),
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
