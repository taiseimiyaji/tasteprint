import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { referenceInputSchema } from "../../domain/reference";
import { ReferenceService, ServiceError } from "./service";
import { CaptureError } from "../capture/proxy";
import { CodexGateway } from "../codex/gateway";
import { FoundationService } from "../foundation/service";
import { foundationRoutes } from "../foundation/routes";
import { ReviewService } from "../review/service";
import { reviewCapture } from "../review/capture";
import { reviewRoutes } from "../review/routes";
export function referenceRoutes(
  service: ReferenceService,
  pairingCode: string,
  gateway = new CodexGateway(),
  allowedPorts = [3000, 3001],
  foundation = new FoundationService(service.db),
  reviews = new ReviewService(
    foundation,
    reviewCapture(`http://127.0.0.1:${allowedPorts.at(-1)}`),
  ),
  trusted = false,
) {
  const sessions = new Set<string>();
  let paired = false;
  const version = z.number().int().positive();
  return new Hono()
    .use("*", async (c, next) => {
      if (trusted) {
        await next();
        return;
      }
      const host = c.req.header("host") || new URL(c.req.url).host;
      if (
        !allowedPorts.some(
          (port) =>
            host === `localhost:${port}` || host === `127.0.0.1:${port}`,
        )
      )
        return c.json({ message: "許可されていないHostです。" }, 403);
      const origin = c.req.header("origin");
      if (origin && origin !== `http://${host}`)
        return c.json({ message: "許可されていないOriginです。" }, 403);
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      if (c.req.path.endsWith("/pair")) {
        if (c.req.method !== "POST" || !origin)
          return c.json({ message: "ブラウザから接続してください。" }, 403);
      } else if (!sessions.has(getCookie(c, "tasteprint_session") || ""))
        return c.json(
          { message: "起動ターミナルの接続コードを入力してください。" },
          401,
        );
      await next();
    })
    .use(
      "*",
      bodyLimit({
        maxSize: 10 * 1024 * 1024 + 65536,
        onError: (c) =>
          c.json({ message: "画像は10MB以下にしてください。" }, 413),
      }),
    )
    .onError((error, c) => {
      if (error instanceof ServiceError)
        return c.json(
          { code: "INVALID_OPERATION", message: error.message },
          error.status,
        );
      if (error instanceof CaptureError)
        return c.json({ code: error.code, message: error.message }, 400);
      if (error instanceof z.ZodError)
        return c.json({ message: "入力内容を確認してください。" }, 400);
      return c.json({ message: "処理に失敗しました。" }, 500);
    })
    .route("/foundation", foundationRoutes(foundation))
    .route("/reviews", reviewRoutes(reviews))
    .post(
      "/pair",
      zValidator("json", z.object({ code: z.string().max(128) })),
      (c) => {
        const a = Buffer.from(c.req.valid("json").code);
        const b = Buffer.from(pairingCode);
        if (paired || a.length !== b.length || !timingSafeEqual(a, b))
          return c.json(
            {
              message:
                "接続コードが無効です。再起動すると新しいコードが表示されます。",
            },
            403,
          );
        paired = true;
        const session = randomBytes(32).toString("hex");
        sessions.add(session);
        setCookie(c, "tasteprint_session", session, {
          httpOnly: true,
          sameSite: "Strict",
          path: "/",
          maxAge: 86400,
        });
        return c.json({ paired: true });
      },
    )
    .get("/", (c) =>
      c.json({ references: service.references(), jobs: service.jobs() }),
    )
    .get("/connection", async (c) => c.json(await gateway.checkConnection()))
    .post("/", zValidator("json", referenceInputSchema), (c) =>
      c.json(service.create(c.req.valid("json")), 201),
    )
    .patch(
      "/:id",
      zValidator("json", referenceInputSchema.extend({ version })),
      (c) => {
        const input = c.req.valid("json");
        return c.json(service.update(c.req.param("id"), input.version, input));
      },
    )
    .delete("/:id", zValidator("json", z.object({ version })), (c) => {
      service.remove(c.req.param("id"), c.req.valid("json").version);
      return c.json({ deleted: true });
    })
    .post("/:id/image", async (c) => {
      const form = await c.req.formData();
      const file = form.get("image");
      const v = version.parse(Number(form.get("version")));
      if (!(file instanceof File))
        return c.json({ message: "画像ファイルが必要です。" }, 400);
      return c.json(
        await service.upload(
          c.req.param("id"),
          v,
          Buffer.from(await file.arrayBuffer()),
        ),
      );
    })
    .get("/:id/image", (c) =>
      c.body(new Uint8Array(service.asset(c.req.param("id"))), 200, {
        "Content-Type": "image/png",
      }),
    )
    .post(
      "/:id/jobs",
      zValidator(
        "json",
        z.object({
          version,
          type: z.enum(["capture", "analyze"]),
          key: z.uuid(),
          consent: z.boolean().optional(),
        }),
      ),
      (c) => {
        const input = c.req.valid("json");
        if (input.type === "analyze" && input.consent !== true)
          return c.json({ message: "送信対象の確認が必要です。" }, 400);
        return c.json(
          service.enqueue(
            c.req.param("id"),
            input.version,
            input.type,
            input.key,
          ),
          202,
        );
      },
    )
    .get("/jobs/:id", (c) => {
      const id = c.req.param("id");
      const after = z.coerce
        .number()
        .int()
        .min(0)
        .parse(c.req.query("after") ?? 0);
      return c.json({
        job: service.job(id),
        events: service.events(id, after),
      });
    })
    .post("/jobs/:id/cancel", (c) => c.json(service.cancel(c.req.param("id"))))
    .post(
      "/:id/accept",
      zValidator("json", z.object({ version, index: z.number().int().min(0) })),
      (c) => {
        const { version: v, index } = c.req.valid("json");
        return c.json(service.accept(c.req.param("id"), v, index));
      },
    );
}
