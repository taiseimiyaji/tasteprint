import { test, expect } from "@playwright/test";

test("connection and AI fixtures never reach host authentication or real Codex", async ({
  request,
}) => {
  const connection = await request.get("/api/connection");
  expect(connection.ok()).toBe(true);
  expect(await connection.json()).toEqual({ state: "ready" });
  const created = await request.post("/api/projects", {
    data: { brief: { name: "E2E isolation" }, useTaste: false },
  });
  expect(created.status()).toBe(201);
  const project = await created.json();
  const foundation = await request.get(
    `/api/projects/${project.id}/foundation`,
  );
  const { current } = await foundation.json();
  const proposal = await request.post(
    `/api/projects/${project.id}/foundation/proposals`,
    {
      data: {
        baseRevision: current.revision,
        prompt: "角丸をもう少し弱くしたい",
      },
    },
  );
  expect(proposal.ok()).toBe(true);
  expect((await proposal.json()).candidates).toHaveLength(2);
  const health = await request.get("/api/health");
  expect((await health.json()).codexCalls).toBe(0);
});
