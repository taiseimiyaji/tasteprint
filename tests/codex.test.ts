import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexGateway } from "../src/server/codex/gateway";
import type { SavedReference } from "../src/domain/reference";
const sdk = vi.hoisted(() => ({
  options: {} as any,
  threadOptions: {} as any,
  input: [] as any[],
  run: vi.fn(),
}));
vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    constructor(options: unknown) {
      sdk.options = options;
    }
    startThread(options: unknown) {
      sdk.threadOptions = options;
      return { run: sdk.run };
    }
  },
}));
const dirs: string[] = [];
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "tasteprint-auth-test-"));
  dirs.push(dir);
  return dir;
}
const reference: SavedReference = {
  id: "test-ref",
  version: 1,
  name: "Example",
  url: "https://example.com",
  selections: [{ aspect: "Motion", intent: "avoid" }],
  likes: "静かな画面",
  dislikes: "動き",
  accepted: [],
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  sdk.run.mockReset();
});
it("fails closed for missing and API-key authentication without invoking Codex", async () => {
  const dir = directory();
  const gateway = new CodexGateway(dir);
  expect(await gateway.checkConnection()).toEqual({ state: "login-required" });
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "fake" }),
  );
  await expect(
    gateway.analyze(reference, "unused", new AbortController().signal),
  ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
  expect(sdk.run).not.toHaveBeenCalled();
});
it("passes the exact image and selected data with a clean environment, structured output and cancellation", async () => {
  const dir = directory();
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "fake-test-token" },
    }),
  );
  const image = join(dir, "source.png");
  writeFileSync(image, "fixture");
  vi.stubEnv("OPENAI_API_KEY", "must-not-inherit");
  vi.stubEnv("CODEX_API_KEY", "must-not-inherit");
  vi.stubEnv("OPENAI_BASE_URL", "https://must-not-inherit.invalid");
  const signal = new AbortController().signal;
  const analysis = {
    referenceId: reference.id,
    findings: [
      {
        aspect: "Motion",
        observation: "判断材料不足",
        interpretation: "動きは不明",
        recommendation: "追加資料で確認する",
        certainty: "insufficient",
        evidence: "静止画のみ",
      },
    ],
  };
  sdk.run.mockImplementation(async (input, options) => {
    expect(input[0].text).toContain("静かな画面");
    expect(input[0].text).toContain('"intent":"avoid"');
    expect(input[1].type).toBe("local_image");
    expect(existsSync(input[1].path)).toBe(true);
    expect(options.signal).toBe(signal);
    expect(options.outputSchema.type).toBe("object");
    return { finalResponse: JSON.stringify(analysis) };
  });
  expect(await new CodexGateway(dir).analyze(reference, image, signal)).toEqual(
    analysis,
  );
  expect(sdk.options.env).not.toHaveProperty("OPENAI_API_KEY");
  expect(sdk.options.env).not.toHaveProperty("CODEX_API_KEY");
  expect(sdk.options.env).not.toHaveProperty("OPENAI_BASE_URL");
  expect(sdk.options.config.forced_login_method).toBe("chatgpt");
  expect(sdk.options.config.features.shell_tool).toBe(false);
  expect(sdk.threadOptions).toMatchObject({
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
  });
  expect(existsSync(sdk.options.env.CODEX_HOME)).toBe(false);
});

it("generates text-only Foundation patches with locked paths excluded from structured output", async () => {
  const { FoundationService } =
    await import("../src/server/foundation/service");
  const { DatabaseSync } = await import("node:sqlite");
  const { defaultDesign } = await import("../src/domain/design");
  const { emptyDecision } = await import("../src/domain/foundation");
  const dir = directory();
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "fake-test-token" },
    }),
  );
  vi.stubEnv("CODEX_HOME", dir);
  const db = new DatabaseSync(":memory:");
  try {
    const service = new FoundationService(db);
    service.initialize({
      ...defaultDesign,
      constraints: {
        radius: {
          ...emptyDecision,
          locked: true,
          scope: "一覧",
          exceptions: "Dialog",
          source: "ユーザー",
        },
      },
    });
    sdk.run.mockImplementation(async (input, options) => {
      expect(input).toHaveLength(1);
      expect(input[0].type).toBe("text");
      expect(input[0].text).toContain('"locked":true');
      const targets =
        options.outputSchema.properties.candidates.items.properties.changes
          .items.properties.target.enum;
      expect(targets).not.toContain("radius");
      expect(targets).toContain("duration");
      expect(targets).not.toContain("constraints");
      return {
        finalResponse: JSON.stringify({
          candidates: [
            {
              explanation: "短い遷移",
              changes: [{ target: "duration", value: 100 }],
            },
          ],
        }),
      };
    });
    const [candidate] = await service.propose(
      1,
      "動きを短く",
      new AbortController().signal,
    );
    expect(candidate.design.duration).toBe(100);
    expect(candidate.design.radius).toBe(6);
    const applied = service.apply(candidate.id);
    expect(applied.decisions).toEqual([
      {
        targetPath: "duration",
        rationale: "短い遷移",
        source: "Codex",
        author: "ai",
      },
    ]);
    expect(existsSync(sdk.options.env.CODEX_HOME)).toBe(false);
  } finally {
    db.close();
  }
});
