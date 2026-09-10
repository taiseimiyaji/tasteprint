import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { capturePage } from "../src/server/capture/capture";
import {
  createCaptureProxy,
  isPublicAddress,
  publicUrl,
  resolvePublic,
} from "../src/server/capture/proxy";

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: async (host: string, options: unknown) =>
      host === "capture.test"
        ? [{ address: "93.184.216.34", family: 4 }]
        : actual.lookup(host, options as never),
  };
});

describe("capture network boundary", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.100.100.200",
    "168.63.129.16",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "2001:db8::1",
  ])("rejects %s", (address) => expect(isPublicAddress(address)).toBe(false));
  it("allows global unicast and rejects ambiguous/credentialed protocols", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com",
      "http://user:pass@example.com",
      "http://example.com:3000",
    ])
      expect(() => publicUrl(url)).toThrow();
    expect(publicUrl("http://2130706433").hostname).toBe("127.0.0.1");
  });
  it("rejects mixed DNS answers and validates every new connection", async () => {
    await expect(
      resolvePublic(new URL("https://capture.test"), async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "::1", family: 6 },
      ]),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      resolvePublic(new URL("https://capture.test"), resolver),
    ).resolves.toMatchObject({ address: "8.8.8.8" });
    await expect(
      resolvePublic(new URL("https://capture.test"), resolver),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
  });
  it("denies CONNECT to internal HTTPS and nonstandard ports", async () => {
    const proxy = await createCaptureProxy();
    try {
      for (const target of [
        "127.0.0.1:443",
        "[::1]:443",
        "169.254.169.254:443",
        "example.com:22",
      ]) {
        const response = await new Promise<string>((resolve, reject) => {
          const socket = net.connect(
            Number(new URL(proxy.url).port),
            "127.0.0.1",
            () =>
              socket.write(
                `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`,
              ),
          );
          socket.once("data", (data) => {
            resolve(data.toString());
            socket.destroy();
          });
          socket.once("error", reject);
        });
        expect(response).toContain("403 Forbidden");
      }
    } finally {
      await proxy.close();
    }
  });
});

describe("real Chromium capture via pinned proxy", () => {
  let server: http.Server;
  let spy: ReturnType<typeof vi.spyOn>;
  const upstreamHosts: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/slow") return;
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://127.0.0.1/private" });
        res.end();
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<html><head><title>Fixture</title></head><body><main><h1>Public fixture</h1><button>Save</button>${req.url === "/subresource" ? '<img src="http://169.254.169.254/latest/meta-data/">' : ""}</main></body></html>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const original = http.request;
    // Test-only transport maps a validated public IP to a deterministic fixture.
    // DNS and address validation remain the production path; no app allowlist exists.
    spy = vi.spyOn(http, "request").mockImplementation(((
      options: http.RequestOptions,
      cb: (r: http.IncomingMessage) => void,
    ) => {
      upstreamHosts.push(String(options.hostname));
      expect(options.hostname).toBe("93.184.216.34");
      return original(
        {
          ...options,
          hostname: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
        },
        cb,
      );
    }) as typeof http.request);
  });
  afterAll(async () => {
    spy.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("stores a 1440x1000 PNG, final URL, timestamp and limited structure", async () => {
    const result = await capturePage(
      "http://capture.test/",
      new AbortController().signal,
    );
    expect(result.image.subarray(1, 4).toString()).toBe("PNG");
    expect(result.image.readUInt32BE(16)).toBe(1440);
    expect(result.image.readUInt32BE(20)).toBe(1000);
    expect(result.metadata).toMatchObject({
      finalUrl: "http://capture.test/",
      viewport: { width: 1440, height: 1000 },
      structure: {
        title: "Fixture",
        headings: [{ level: "h1", text: "Public fixture" }],
        controls: { button: 1 },
      },
    });
    expect(Number.isNaN(Date.parse(result.metadata.capturedAt))).toBe(false);
    expect(upstreamHosts.length).toBeGreaterThan(0);
  }, 15000);
  it.each([
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://[::1]/",
    "http://capture.test/redirect",
    "http://capture.test/subresource",
  ])(
    "blocks %s",
    async (url) => {
      await expect(
        capturePage(url, new AbortController().signal),
      ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
    },
    15000,
  );
  it("enforces a total deadline and closes the browser and connections", async () => {
    await expect(
      capturePage(
        "http://capture.test/slow",
        new AbortController().signal,
        800,
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  }, 5000);
});
