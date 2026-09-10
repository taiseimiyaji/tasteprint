import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { app } from "./app";
const built = import.meta.url.includes("/dist/");
if (built) {
  const root = fileURLToPath(new URL("../client/", import.meta.url));
  app.use("/assets/*", serveStatic({ root }));
  app.get("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.get("*", serveStatic({ path: `${root}index.html` }));
}
const port = Number(process.env.PORT || (built ? 3000 : 3001));
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () =>
  console.log(
    `Tasteprint ${built ? "app" : "mock API"}: http://127.0.0.1:${port}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
