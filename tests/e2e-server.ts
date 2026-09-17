// Deterministic E2E server. This fixture is never imported by the production entrypoint.
import { serve } from "@hono/node-server";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FoundationService } from "../src/server/foundation/service";
import { Hono } from "hono";
const app = new Hono().get("/api/health", (c) => c.json({ ready: true }));
import { ReferenceService } from "../src/server/references/service";
import { referenceRoutes } from "../src/server/references/routes";
import { CaptureError } from "../src/server/capture/proxy";
import { ReviewService } from "../src/server/review/service";
import { reviewCapture } from "../src/server/review/capture";
const dir = mkdtempSync(join(tmpdir(), "tasteprint-e2e-"));
import { ProjectService } from "../src/server/projects/service";
import { projectRoutes } from "../src/server/projects/routes";
const service = new ProjectService(dir, {
  referenceFactory: (directory) =>
    new ReferenceService(
      directory,
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
    ),
  generate: async (design, prompt) =>
    prompt.startsWith("部品を調整")
      ? {
          candidates: [
            {
              design: {
                ...design,
                components: {
                  ...design.components,
                  Button: { ...design.components.Button, size: "lg" },
                },
              },
              explanation: "押しやすいボタンにします",
            },
          ],
        }
      : {
          candidates: [
            {
              design: {
                ...design,
                radius: design.constraints.radius ? design.radius : 4,
              },
              explanation: "角丸を小さくします",
            },
            {
              design: {
                ...design,
                radius: design.constraints.radius ? design.radius : 2,
              },
              explanation: "直線的に整えます",
            },
          ],
        },
  previewOrigin: "http://127.0.0.1:3100",
  reviewAI: async () => ({
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
});
app.route("/api", projectRoutes(service, "e2e-pair-code", [3100, 3101]));
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
