import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class CaptureError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function publicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CaptureError(
      "INVALID_URL",
      "有効なHTTP(S) URLを入力してください。",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new CaptureError(
      "INVALID_URL",
      "認証情報を含まない、標準ポートの公開HTTP(S) URLのみ取得できます。",
    );
  return url;
}
export function isPublicAddress(address: string): boolean {
  try {
    // Reject IPv4-mapped IPv6, NAT64, 6to4, Teredo and all non-global ranges.
    if (address === "168.63.129.16") return false; // Azure platform virtual IP
    const ip = ipaddr.parse(address);
    if (ip.range() !== "unicast") return false;
    return (
      ip.kind() === "ipv4" || ip.match(ipaddr.parse("2000::") as ipaddr.IPv6, 3)
    );
  } catch {
    return false;
  }
}
export type Resolver = (
  host: string,
) => Promise<{ address: string; family: number }[]>;
const systemResolve: Resolver = (host) =>
  lookup(host, { all: true, verbatim: true });
export async function resolvePublic(
  url: URL,
  resolve: Resolver = systemResolve,
) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await resolve(host);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new CaptureError(
      "BLOCKED_ADDRESS",
      "内部・予約済みアドレスへの通信を拒否しました。画像アップロードで続行できます。",
    );
  return addresses[0];
}

// Every TCP connection is made to a validated literal IP. Neither http.request nor
// CONNECT performs a second DNS lookup; redirects and subresources use this same path.
export async function createCaptureProxy(
  options: {
    resolve?: Resolver;
    onBlocked?: (error: CaptureError) => void;
  } = {},
) {
  const sockets = new Set<net.Socket>();
  let closed = false;
  function track(socket: net.Socket) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(30_000, () => socket.destroy());
    return socket;
  }
  async function target(input: string) {
    const url = publicUrl(input);
    const address = await resolvePublic(url, options.resolve);
    if (closed) throw new Error("Proxy closed");
    return { url, ...address };
  }
  function denied(error: unknown) {
    if (error instanceof CaptureError) options.onBlocked?.(error);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const { url, address, family } = await target(req.url || "");
      if (
        url.protocol !== "http:" ||
        !["GET", "HEAD"].includes(req.method || "")
      )
        throw new CaptureError(
          "BLOCKED_REQUEST",
          "取得対象外の通信を拒否しました。",
        );
      const upstream = http.request(
        {
          hostname: address,
          family,
          port: Number(url.port || 80),
          method: req.method,
          path: url.pathname + url.search,
          agent: false,
          // Do not forward browser credentials, proxy headers or hop-by-hop headers.
          headers: {
            host: url.host,
            "user-agent": req.headers["user-agent"] || "Tasteprint",
            accept: req.headers.accept || "*/*",
          },
        },
        (response) => {
          const headers = { ...response.headers };
          delete headers["set-cookie"];
          delete headers["connection"];
          delete headers["transfer-encoding"];
          res.writeHead(response.statusCode || 502, headers);
          response.pipe(res);
        },
      );
      upstream.on("socket", track);
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      res.on("close", () => upstream.destroy());
      upstream.end();
    } catch (error) {
      denied(error);
      res.writeHead(403);
      res.end("Capture request blocked");
    }
  });
  server.on("connection", track);
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("connect", async (req, client, head) => {
    try {
      const { address, family, url } = await target(`https://${req.url}`);
      if (
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        (url.port && url.port !== "443")
      )
        throw new CaptureError(
          "BLOCKED_REQUEST",
          "HTTPS通信先を拒否しました。",
        );
      const upstream = track(net.connect({ host: address, family, port: 443 }));
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
    } catch (error) {
      denied(error);
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    close: async () => {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
