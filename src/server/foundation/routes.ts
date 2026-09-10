import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { designSchema } from "../../domain/design";
import { FoundationService } from "./service";
const revision = z.number().int().positive();
const requestId = z.string().uuid();
export function foundationRoutes(service: FoundationService) {
  return new Hono()
    .get("/", (c) =>
      c.json({ current: service.current(), history: service.history() }),
    )
    .post(
      "/initialize",
      zValidator("json", z.object({ design: designSchema })),
      (c) => c.json(service.initialize(c.req.valid("json").design)),
    )
    .post(
      "/save",
      zValidator(
        "json",
        z.object({
          baseRevision: revision,
          design: designSchema,
          reason: z.string().trim().min(1).max(2000),
          requestId,
        }),
      ),
      (c) => {
        const v = c.req.valid("json");
        return c.json(
          service.save(v.baseRevision, v.design, v.reason, v.requestId),
        );
      },
    )
    .post(
      "/restore",
      zValidator(
        "json",
        z.object({ baseRevision: revision, target: revision, requestId }),
      ),
      (c) => {
        const v = c.req.valid("json");
        return c.json(service.restore(v.baseRevision, v.target, v.requestId));
      },
    )
    .post(
      "/proposals",
      zValidator(
        "json",
        z.object({
          baseRevision: revision,
          prompt: z.string().trim().min(1).max(1000),
        }),
      ),
      async (c) => {
        const v = c.req.valid("json");
        return c.json({
          candidates: await service.propose(
            v.baseRevision,
            v.prompt,
            AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(120000)]),
          ),
        });
      },
    )
    .post(
      "/apply",
      zValidator("json", z.object({ id: z.string().uuid() })),
      (c) => c.json(service.apply(c.req.valid("json").id)),
    );
}
