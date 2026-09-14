import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProjectService } from "./service";
import { ServiceError } from "../references/service";
import { CaptureError } from "../capture/proxy";
import { referenceRoutes } from "../references/routes";
import { foundationRoutes } from "../foundation/routes";
import { reviewRoutes } from "../review/routes";
import {
  briefSchema,
  principleSchema,
  tasteSchema,
} from "../../domain/projects";
import { CodexGateway } from "../codex/gateway";
const revision = z.number().int().positive();
export function projectRoutes(
  service: ProjectService,
  code: string,
  ports = [3000, 3001],
) {
  const sessions = new Set<string>();
  let paired = false;
  const apps = new Map<string, Hono>();
  const handleError = (e: Error, c: import("hono").Context) =>
    e instanceof ServiceError
      ? c.json({ message: e.message }, e.status)
      : e instanceof z.ZodError
        ? c.json(
            { message: "入力内容を確認してください。", details: e.issues },
            400,
          )
        : e instanceof CaptureError
          ? c.json({ message: e.message }, 400)
          : c.json(
              {
                message:
                  "処理に失敗しました。保存内容を保持したまま再試行してください。",
              },
              500,
            );
  const routes = new Hono()
    .use("*", async (c, next) => {
      const host = c.req.header("host") || new URL(c.req.url).host,
        origin = c.req.header("origin");
      if (
        !ports.some(
          (p) => host === `localhost:${p}` || host === `127.0.0.1:${p}`,
        ) ||
        (origin && origin !== `http://${host}`)
      )
        return c.json({ message: "許可されていないHost・Originです。" }, 403);
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      if (
        !c.req.path.endsWith("/pair") &&
        !sessions.has(getCookie(c, "tasteprint_session") || "")
      )
        return c.json(
          { message: "起動ターミナルの接続コードを入力してください。" },
          401,
        );
      await next();
    })
    .use(
      "*",
      bodyLimit({
        maxSize: 32 * 1024 * 1024,
        onError: (c) => c.json({ message: "保存データが大きすぎます。" }, 413),
      }),
    )
    .onError(handleError)
    .post("/pair", async (c) => {
      if (!c.req.header("origin"))
        return c.json({ message: "ブラウザから接続してください。" }, 403);
      const a = Buffer.from(
          z.object({ code: z.string().max(128) }).parse(await c.req.json())
            .code,
        ),
        b = Buffer.from(code);
      if (paired || a.length !== b.length || !timingSafeEqual(a, b))
        return c.json(
          { message: "接続コードが無効です。再起動して確認してください。" },
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
    })
    .get("/connection", async (c) =>
      c.json(await new CodexGateway().checkConnection()),
    )
    .get("/profile", (c) =>
      c.json({ current: service.taste(), history: service.profileHistory() }),
    )
    .post("/profile", async (c) => {
      const v = tasteSchema
        .extend({ baseProfileRevision: revision })
        .parse(await c.req.json());
      return c.json(service.saveTaste(v.baseProfileRevision, v));
    })
    .post("/migration/browser", async (c) =>
      c.json(await service.importBrowser(await c.req.json())),
    )
    .get("/projects", (c) => c.json(service.list()))
    .post("/projects", async (c) => {
      const v = z
        .object({
          brief: briefSchema,
          useTaste: z.boolean().default(true),
          sourceTasteProfileRevision: revision.optional(),
        })
        .parse(await c.req.json());
      return c.json(
        service.create(v.brief, v.useTaste, v.sourceTasteProfileRevision),
        201,
      );
    })
    .get("/projects/:id", (c) =>
      c.json({
        project: service.project(c.req.param("id")),
        current: service.revision(c.req.param("id")),
      }),
    )
    .post("/projects/:id", async (c) => {
      const v = z
        .object({
          baseRevision: revision,
          brief: briefSchema,
          policies: z.array(principleSchema).max(100),
        })
        .parse(await c.req.json());
      return c.json(
        service.saveProject(
          c.req.param("id"),
          v.baseRevision,
          v.brief,
          v.policies,
        ),
      );
    })
    .post("/projects/:id/archive", async (c) => {
      const v = z
        .object({ baseRevision: revision, archived: z.boolean() })
        .parse(await c.req.json());
      return c.json(
        service.archive(c.req.param("id"), v.baseRevision, v.archived),
      );
    })
    .get("/projects/:id/taste-diff", (c) =>
      c.json(service.diff(c.req.param("id"))),
    )
    .post("/projects/:id/taste-diff", async (c) => {
      const v = z
        .object({
          baseRevision: revision,
          baseProfileRevision: revision,
          choices: z.record(z.string(), z.enum(["adopt", "keep"])),
        })
        .parse(await c.req.json());
      return c.json(
        service.adopt(
          c.req.param("id"),
          v.baseRevision,
          v.baseProfileRevision,
          v.choices,
        ),
      );
    })
    .post("/projects/:id/promote", async (c) => {
      const v = z
        .object({
          baseRevision: revision,
          baseProfileRevision: revision,
          ids: z.array(z.string()).min(1).max(100),
        })
        .parse(await c.req.json());
      return c.json(
        service.promote(
          c.req.param("id"),
          v.baseRevision,
          v.baseProfileRevision,
          v.ids,
        ),
      );
    })
    .get("/projects/:id/conversations", (c) =>
      c.json(service.conversations(c.req.param("id"))),
    )
    .post("/projects/:id/conversations", async (c) => {
      const v = z
        .object({
          baseRevision: revision,
          text: z.string().trim().min(1).max(1000),
        })
        .parse(await c.req.json());
      return c.json(
        service.addConversation(c.req.param("id"), v.baseRevision, v.text),
      );
    })
    .get("/projects/:id/exports", (c) =>
      c.json(service.exportSummaries(c.req.param("id"))),
    )
    .post("/projects/:id/exports", async (c) => {
      const v = z.object({ baseRevision: revision }).parse(await c.req.json());
      return c.json(service.export(c.req.param("id"), v.baseRevision));
    })
    .get("/projects/:id/exports/:exportId/:filename", (c) => {
      const r = service
          .exports(c.req.param("id"))
          .find((r) => r.id === c.req.param("exportId")),
        file = c.req.param("filename");
      if (!r || !Object.hasOwn(r.files, file))
        throw new ServiceError(404, "成果物が見つかりません。");
      return c.body(r.files[file], 200, {
        "Content-Type": file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".css")
            ? "text/css"
            : "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file}"`,
      });
    });
  routes.all("/projects/:id/*", async (c) => {
    const id = c.req.param("id"),
      scope = service.scope(id);
    if (!["GET", "HEAD"].includes(c.req.method)) service.writable(id);
    let app = apps.get(id);
    if (!app) {
      app = new Hono()
        .onError(handleError)
        .route(
          "/references",
          referenceRoutes(
            scope.references,
            "",
            undefined,
            ports,
            scope.foundation,
            scope.reviews,
            true,
          ),
        )
        .route("/foundation", foundationRoutes(scope.foundation))
        .route("/reviews", reviewRoutes(scope.reviews));
      apps.set(id, app);
    }
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(`/api/projects/${id}`, "");
    return app.fetch(new Request(url, c.req.raw));
  });
  const shared = referenceRoutes(
    service.shared,
    "",
    undefined,
    ports,
    undefined,
    undefined,
    true,
  );
  routes.all("/profile/references/*", (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace("/api/profile/references", "") || "/";
    if (/^\/(foundation|reviews|pair)(\/|$)/.test(url.pathname))
      throw new ServiceError(404, "共通プロフィールには設計を保存できません。");
    return shared.fetch(new Request(url, c.req.raw));
  });
  routes.all("/profile/references", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/";
    return shared.fetch(new Request(url, c.req.raw));
  });
  return routes;
}
