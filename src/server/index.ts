import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { app } from "./app";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ReferenceService } from "./references/service";
import { referenceRoutes } from "./references/routes";
const built = import.meta.url.includes("/dist/");
const port = Number(process.env.PORT || (built ? 3000 : 3001));
const references = new ReferenceService(
  process.env.TASTEPRINT_DATA_DIR || join(homedir(), ".tasteprint"),
);
const pairingCode = randomBytes(16).toString("hex");
app.route(
  "/api/references",
  referenceRoutes(references, pairingCode, undefined, [
    port,
    ...(built ? [] : [3000]),
  ]),
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
