import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
const app = new Hono();
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ProjectService } from "./projects/service";
import { projectRoutes } from "./projects/routes";
const built = import.meta.url.includes("/dist/");
const port = Number(process.env.PORT || (built ? 3000 : 3001));
const references = new ProjectService(
  process.env.TASTEPRINT_DATA_DIR || join(homedir(), ".tasteprint"),
  { previewOrigin: `http://127.0.0.1:${built ? port : 3000}` },
);
const pairingCode = randomBytes(16).toString("hex");
app.route(
  "/api",
  projectRoutes(references, pairingCode, [port, ...(built ? [] : [3000])]),
);
console.log(`Tasteprint 接続コード: ${pairingCode}`);
if (built) {
  const root = fileURLToPath(new URL("../client/", import.meta.url));
  app.use("/assets/*", serveStatic({ root }));
  app.get("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.get("*", serveStatic({ path: `${root}index.html` }));
}
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () =>
  console.log(
    `Tasteprint ${built ? "app" : "mock API"}: http://127.0.0.1:${port}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      void references.close().then(() => process.exit(0));
    }),
  );
