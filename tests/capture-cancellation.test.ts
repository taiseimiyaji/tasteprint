import { afterEach, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import net from "node:net";
import { capturePage } from "../src/server/capture/capture";
import * as proxyModule from "../src/server/capture/proxy";

const createProxy = proxyModule.createCaptureProxy;
afterEach(() => vi.restoreAllMocks());

function observeProxy() {
  const prepared: {
    url: string;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const spy = vi
    .spyOn(proxyModule, "createCaptureProxy")
    .mockImplementation(async (options) => {
      const proxy = await createProxy(options);
      const observed = { url: proxy.url, close: vi.fn(proxy.close) };
      prepared.push(observed);
      return observed;
    });
  return { prepared, spy };
}

async function expectClosed(url: string) {
  const socket = net.connect(Number(new URL(url).port), "127.0.0.1");
  try {
    const outcome = await new Promise<string>((resolve) => {
      socket.once("connect", () => resolve("unexpected connection"));
      socket.once("error", (error: NodeJS.ErrnoException) =>
        resolve(error.code ?? error.message),
      );
    });
    expect(outcome).toBe("ECONNREFUSED");
  } finally {
    socket.destroy();
  }
}

it("pre-aborted capture prepares no proxy and launches no browser", async () => {
  const proxy = observeProxy();
  const launch = vi.spyOn(chromium, "launch");
  const reason = new Error("Already canceled");
  await expect(
    capturePage("http://capture.test/", AbortSignal.abort(reason)),
  ).rejects.toBe(reason);
  expect(proxy.spy).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
});

it("cancellation during real loopback proxy startup closes it without launching Chromium", async () => {
  const proxy = observeProxy();
  const close = vi.fn(async () => {});
  const launch = vi
    .spyOn(chromium, "launch")
    .mockResolvedValue({ close } as unknown as Browser);
  const controller = new AbortController();
  const reason = new Error("Canceled while proxy starts");
  const pending = capturePage("http://capture.test/", controller.signal);
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  expect(proxy.prepared).toHaveLength(1);
  expect(proxy.prepared[0].close).toHaveBeenCalledTimes(1);
  await expectClosed(proxy.prepared[0].url);
  expect(launch).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it("cancellation after launch begins still waits for browser cleanup and preserves the reason", async () => {
  const proxy = observeProxy();
  let completeLaunch!: (browser: Browser) => void;
  const launch = vi.spyOn(chromium, "launch").mockImplementation(
    () =>
      new Promise((resolve) => {
        completeLaunch = resolve;
      }),
  );
  const close = vi.fn(async () => {});
  const newContext = vi.fn();
  const controller = new AbortController();
  const reason = new Error("Canceled during launch");
  let settled = false;
  const outcome = capturePage("http://capture.test/", controller.signal)
    .then(
      () => "unexpected success",
      (error) => error,
    )
    .finally(() => {
      settled = true;
    });
  const browser = { close, newContext } as unknown as Browser;
  try {
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    controller.abort(reason);
    await vi.waitFor(() =>
      expect(proxy.prepared[0].close).toHaveBeenCalledTimes(1),
    );
    await expectClosed(proxy.prepared[0].url);
    expect(settled).toBe(false);
    completeLaunch(browser);
    expect(await outcome).toBe(reason);
    expect(settled).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(newContext).not.toHaveBeenCalled();
  } finally {
    controller.abort(reason);
    completeLaunch?.(browser);
    await outcome;
  }
});
