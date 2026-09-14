import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { FoundationService } from "../src/server/foundation/service";
import { ReviewService } from "../src/server/review/service";
import { defaultDesign } from "../src/domain/design";
import type { CaptureReview } from "../src/server/review/capture";
const capture: CaptureReview = async (_, screen) => ({
  image: Buffer.from(screen),
  verifiedRules: ["color-contrast"],
  scope: [screen],
  findings: [
    {
      id: randomUUID(),
      source: "machine",
      ruleId: "color-contrast",
      targetPath: `${screen}:button`,
      severity: "error",
      evidence: "2.1:1 < 4.5:1",
      explanation: "コントラスト不足",
      suggestedChange: "文字色を濃くする",
    },
  ],
});
function setup(c = capture) {
  const db = new DatabaseSync(":memory:");
  const foundation = new FoundationService(db, async (design) => ({
    candidates: [
      { design: { ...design, radius: 4 }, explanation: "角丸を修正" },
    ],
  }));
  foundation.initialize(defaultDesign, { density: 0.8, contrast: null });
  const service = new ReviewService(foundation, c, async (r, images) => {
    expect(images).toHaveLength(3);
    expect(r.images).toHaveLength(3);
    return {
      findings: [
        {
          ruleId: "visual-hierarchy",
          targetPath: "list:heading",
          severity: "warning",
          evidence: "一覧の見出しと本文の強弱が小さい",
          explanation: "階層を要確認",
          suggestedChange: "見出しを強調",
        },
      ],
    };
  });
  return { db, foundation, service };
}
describe("revision-bound visual review", () => {
  it("persists three images, DNA, machine evidence and AI interpretation separately", async () => {
    const { db, foundation, service } = setup();
    try {
      const r = await service.run(1, new AbortController().signal);
      expect(r.status).toBe("complete");
      expect(r.verifiedRules).toEqual(["color-contrast"]);
      expect(r.findings.filter((f) => f.source === "machine")).toHaveLength(3);
      expect(r.findings.filter((f) => f.source === "ai")).toHaveLength(1);
      expect(r.dna).toMatchObject({
        profile: { density: 0.8, contrast: null },
      });
      expect(Buffer.from(service.image(r.images[1])).toString()).toBe(
        "settings",
      );
      service.dismiss(r.id, r.findings[0].id, "意図した例外");
      expect(
        new ReviewService(foundation, capture).get(r.id).findings[0].dismissal,
      ).toBe("意図した例外");
    } finally {
      db.close();
    }
  });
  it("preserves partial results on image failure without calling AI", async () => {
    const { db, service } = setup(async (d, s, signal) => {
      if (s === "settings") throw new Error("撮影失敗");
      return capture(d, s, signal);
    });
    try {
      const r = await service.run(1, new AbortController().signal);
      expect(r.status).toBe("partial");
      expect(r.error).toBe("撮影失敗");
      expect(r.images).toHaveLength(1);
      expect(r.findings.every((f) => f.source === "machine")).toBe(true);
    } finally {
      db.close();
    }
  });
  it("previews before explicit apply and rejects stale fixes", async () => {
    const { db, service, foundation } = setup();
    try {
      const r = await service.run(1, new AbortController().signal);
      const [candidate] = await service.propose(
        r.id,
        new AbortController().signal,
      );
      expect(foundation.current()?.revision).toBe(1);
      foundation.save(
        1,
        { ...defaultDesign, spacing: 16 },
        "編集",
        randomUUID(),
      );
      expect(service.get(r.id).stale).toBe(true);
      expect(() => foundation.apply(candidate.id)).toThrow(/更新/);
      await expect(
        service.propose(r.id, new AbortController().signal),
      ).rejects.toThrow(/古い/);
      await expect(
        service.run(1, new AbortController().signal),
      ).rejects.toThrow(/古い/);
    } finally {
      db.close();
    }
  });
  it("marks a result stale when revision changes during capture", async () => {
    const { db, service, foundation } = setup(async (d, s, signal) => {
      if (s === "list") foundation.save(1, d, "編集中", randomUUID());
      return capture(d, s, signal);
    });
    try {
      expect((await service.run(1, new AbortController().signal)).stale).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });
  it("applies a current candidate as a new revision with the same DNA", async () => {
    const { db, service, foundation } = setup();
    try {
      const r = await service.run(1, new AbortController().signal);
      const [c] = await service.propose(r.id, new AbortController().signal);
      const next = foundation.apply(c.id);
      expect(next.revision).toBe(2);
      expect(next.design.radius).toBe(4);
      expect(next.dna).toEqual({ density: 0.8, contrast: null });
    } finally {
      db.close();
    }
  });
});
