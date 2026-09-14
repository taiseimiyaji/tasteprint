import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ReviewService } from "./service";
export function reviewRoutes(service: ReviewService) {
  return new Hono()
    .get("/", (c) => c.json(service.list()))
    .get("/images/:id", (c) =>
      c.body(
        new Uint8Array(
          service.image(z.string().uuid().parse(c.req.param("id"))),
        ),
        200,
        { "Content-Type": "image/png" },
      ),
    )
    .post(
      "/",
      zValidator(
        "json",
        z.object({ baseRevision: z.number().int().positive() }),
      ),
      async (c) =>
        c.json(
          await service.run(
            c.req.valid("json").baseRevision,
            AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(300000)]),
          ),
        ),
    )
    .post(
      "/:id/dismiss",
      zValidator(
        "json",
        z.object({
          baseRevision: z.number().int().positive(),
          findingId: z.string().uuid(),
          reason: z.string().max(2000),
        }),
      ),
      (c) => {
        const v = c.req.valid("json");
        return c.json(
          service.dismiss(
            c.req.param("id"),
            v.findingId,
            v.reason,
            v.baseRevision,
          ),
        );
      },
    )
    .post("/:id/proposals", async (c) =>
      c.json({
        candidates: await service.propose(
          c.req.param("id"),
          AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(120000)]),
        ),
      }),
    );
}
