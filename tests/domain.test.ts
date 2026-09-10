import { describe, expect, it } from "vitest";
import { defaultDesign, designMarkdown, profile } from "../src/domain/design";
import { app } from "../src/server/app";

describe("mock design workflow", () => {
  it("keeps unanswered taste axes unknown and excludes skipped answers", () => {
    expect(
      profile({ "density-0": "a", "density-1": "skip", "roundness-0": "both" }),
    ).toMatchObject({ density: 0.2, roundness: 0.5, decoration: null });
  });
  it("returns a proposal without mutating the supplied design", async () => {
    const response = await app.request("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "角丸を弱く", design: defaultDesign }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      supported: true,
      design: { radius: 4 },
      source: "mock",
    });
    expect(defaultDesign.radius).toBe(6);
  });
  it("rejects invalid design values at the HTTP boundary", async () => {
    const response = await app.request("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "角丸を弱く",
        design: { ...defaultDesign, radius: -1 },
      }),
    });
    expect(response.status).toBe(400);
  });
  it("does not invent an AI response for an unsupported request", async () => {
    const response = await app.request("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "このサイトを解析して",
        design: defaultDesign,
      }),
    });
    expect(await response.json()).toMatchObject({ supported: false });
  });
  it("exports current settings and explicitly marks unreviewed output", () => {
    const output = designMarkdown({ ...defaultDesign, radius: 12 }, {}, []);
    expect(output).toContain("Surface radius: 12px");
    expect(output).toContain("Codexによる分析・レビューは未実施");
    expect(output).toContain("## Application Patterns");
  });
});
