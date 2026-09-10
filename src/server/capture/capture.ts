import { chromium, type Browser } from "playwright";
import type { CaptureMetadata } from "../../domain/reference";
import { CaptureError, createCaptureProxy, publicUrl } from "./proxy";
export const viewport = { width: 1440, height: 1000 };
export type CaptureResult = { image: Buffer; metadata: CaptureMetadata };
export async function capturePage(
  input: string,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<CaptureResult> {
  const url = publicUrl(input);
  signal.throwIfAborted();
  let browser: Browser | undefined;
  let blocked: CaptureError | undefined;
  let expired = false;
  const proxy = await createCaptureProxy({
    onBlocked: (error) => {
      blocked ??= error;
    },
  });
  const stop = () => {
    void proxy.close();
    void browser?.close();
  };
  const timer = setTimeout(() => {
    expired = true;
    stop();
  }, timeoutMs);
  signal.addEventListener("abort", stop, { once: true });
  try {
    browser = await chromium.launch({
      timeout: timeoutMs,
      proxy: { server: proxy.url, bypass: "<-loopback>" },
      args: [
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ],
    });
    if (expired || signal.aborted) throw new Error("Stopped");
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", (route) => {
      const request = route.request();
      try {
        if (
          request.url().startsWith("data:") ||
          request.url().startsWith("blob:")
        )
          return route.continue();
        publicUrl(request.url());
        if (!["GET", "HEAD"].includes(request.method())) return route.abort();
        return route.continue();
      } catch {
        return route.abort();
      }
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    context.on("page", (popup) => {
      if (popup !== page) void popup.close();
    });
    page.on("dialog", (dialog) => void dialog.dismiss());
    const response = await page.goto(url.href, {
      waitUntil: "load",
      timeout: timeoutMs,
    });
    if (blocked) throw blocked;
    if (!response || response.status() >= 400)
      throw new CaptureError(
        "HTTP_ERROR",
        `ページを取得できませんでした（HTTP ${response?.status() ?? "unknown"}）。`,
      );
    if (!response.headers()["content-type"]?.includes("text/html"))
      throw new CaptureError("NOT_HTML", "公開HTMLページを指定してください。");
    if (await page.locator('input[type="password"]').count())
      throw new CaptureError(
        "LOGIN_REQUIRED",
        "ログイン画面は取得対象外です。画像アップロードで続行してください。",
      );
    const structure = await page.evaluate(() => ({
      title: document.title.slice(0, 200),
      headings: Array.from(document.querySelectorAll("h1,h2,h3"))
        .slice(0, 30)
        .map((el) => ({
          level: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 200),
        })),
      landmarks: Object.fromEntries(
        ["header", "nav", "main", "aside", "footer"].map((tag) => [
          tag,
          document.querySelectorAll(tag).length,
        ]),
      ),
      controls: Object.fromEntries(
        ["button", "input", "select", "table", "form"].map((tag) => [
          tag,
          document.querySelectorAll(tag).length,
        ]),
      ),
    }));
    const image = await page.screenshot({
      type: "png",
      fullPage: false,
      timeout: timeoutMs,
    });
    if (blocked) throw blocked;
    if (expired || signal.aborted) throw new Error("Stopped");
    return {
      image,
      metadata: {
        capturedAt: new Date().toISOString(),
        finalUrl: page.url(),
        viewport,
        structure,
      },
    };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (expired || (error instanceof Error && error.name === "TimeoutError"))
      throw new CaptureError(
        "TIMEOUT",
        "30秒以内に取得できませんでした。再試行するか画像をアップロードしてください。",
      );
    if (blocked) throw blocked;
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(
      "CAPTURE_FAILED",
      "ページを取得できませんでした。URL・接続状態・Chromiumのインストールを確認するか、画像をアップロードしてください。",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    await proxy.close();
    await browser?.close();
  }
}
