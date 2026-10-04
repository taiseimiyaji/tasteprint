import { request, type FullConfig } from "@playwright/test";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

// Pair once per run. Restarted workers reuse only this fixture server's session.
export default async function setup(config: FullConfig) {
  const { baseURL, storageState } = config.projects[0].use;
  if (!baseURL || typeof storageState !== "string")
    throw new Error("E2E baseURL and storageState must be configured.");
  const client = await request.newContext({ baseURL });
  try {
    const response = await client.post("/api/pair", {
      headers: { Origin: baseURL },
      data: { code: "e2e-pair-code" },
    });
    if (!response.ok())
      throw new Error(`E2E pairing failed (HTTP ${response.status()}).`);
    await mkdir(dirname(storageState), { recursive: true });
    await client.storageState({ path: storageState });
    await chmod(storageState, 0o600);
  } finally {
    await client.dispose();
  }
  return async () => {
    const audit = await request.newContext({ baseURL });
    try {
      const health = await audit.get("/api/health");
      if (!health.ok() || (await health.json()).codexCalls !== 0)
        throw new Error(
          "E2E attempted to access host authentication or real Codex.",
        );
    } finally {
      await audit.dispose();
      await rm(storageState, { force: true });
    }
  };
}
