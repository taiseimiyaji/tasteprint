import type { Context } from "hono";

export function publicOrigin(value?: string) {
  if (!value) return undefined;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.hostname.includes("*")
  )
    throw new Error("TASTEPRINT_PUBLIC_ORIGIN must be an exact HTTPS origin");
  return url.origin;
}

export function requestOrigin(ports: number[], externalOrigin?: string) {
  const external = publicOrigin(externalOrigin);
  const externalHost = external && new URL(external).host;
  return (c: Context) => {
    const host = c.req.header("host") || new URL(c.req.url).host;
    const expected =
      externalHost && host === externalHost
        ? external
        : ports.some(
              (p) => host === `localhost:${p}` || host === `127.0.0.1:${p}`,
            )
          ? `http://${host}`
          : undefined;
    const origin = c.req.header("origin");
    const changesState = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    if (!expected || ((origin || changesState) && origin !== expected))
      return undefined;
    return { secure: expected === external };
  };
}
