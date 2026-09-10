import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { designSchema, defaultDesign } from "../domain/design";

export const app = new Hono()
  .get("/api/connection", (c) =>
    c.json({
      mode: "mock" as const,
      connected: false,
      name: "Tasteprint mock gateway",
    }),
  )
  .get("/api/workspace", (c) =>
    c.json({ name: "Personal workspace", design: defaultDesign }),
  )
  .post(
    "/api/proposals",
    zValidator(
      "json",
      z.object({
        prompt: z.string().trim().min(1).max(1000),
        design: designSchema,
      }),
    ),
    (c) => {
      const { prompt, design } = c.req.valid("json");
      const next = { ...design };
      let explanation = "";
      if (/角丸|radius|丸み/.test(prompt)) {
        next.radius = Math.max(0, design.radius - 2);
        explanation = "角丸を2px小さくして、より端正な印象にします。";
      } else if (/余白|詰め|密度|compact/.test(prompt)) {
        next.spacing = Math.max(8, design.spacing - 2);
        explanation = "行の上下余白を2px減らし、一覧性を高めます。";
      } else if (/青|blue/.test(prompt)) {
        next.accent = "#526f99";
        explanation = "アクセントを落ち着いたブルーに変更します。";
      } else if (/影|shadow/.test(prompt)) {
        next.shadow = false;
        explanation = "静的な面の影をなくして、情報をフラットに整えます。";
      } else
        return c.json({
          supported: false as const,
          message:
            "モックでは「角丸を弱く」「余白を詰めたい」「青に変更」「影をなくす」を試せます。自由な対話はCodex連携で追加します。",
        });
      if (
        Object.keys(next).some(
          (key) =>
            design.constraints[key]?.locked &&
            JSON.stringify(next[key as keyof typeof next]) !==
              JSON.stringify(design[key as keyof typeof design]),
        )
      )
        return c.json({
          supported: false as const,
          message: "ロックした項目は変更できません。",
        });
      return c.json({
        supported: true as const,
        design: next,
        explanation,
        source: "mock" as const,
      });
    },
  );
export type AppType = typeof app;
