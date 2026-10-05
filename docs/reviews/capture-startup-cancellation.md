# Capture startup cancellation

Issue #136 concerns cancellation during the asynchronous creation of the local capture proxy. The initial AbortSignal check has already passed, while the later abort listener has not yet been attached. Chromium launch can therefore start after cancellation and occupy the capture slot until launch settles.

An actual capturePage/loopback-proxy probe with a controlled Chromium launch reproduces this window without navigation, external DNS or SDK calls. The permanent regression also fails on the original source because launch is called once after cancellation.

A second AbortSignal check inside the existing try/finally immediately before launch closes this window. The original cancellation reason is preserved; the prepared proxy is closed without launching a browser. Cancellation after launch begins still waits for browser cleanup before the task settles, preserving the existing Reference queue contract.

Three regression cases cover pre-aborted input, abort during actual loopback proxy startup, and abort during controlled browser launch. They verify the same reason, launch counts, proxy closure by refused loopback connection, and cleanup before settlement. Existing tests continue exercising real Chromium normal capture, address/redirect/subresource rejection, total deadline and Reference queue behavior.

No URL allowlist, network validation, authentication, AI policy, timeout, saved record or visible behavior changes. Browser workflow checks use Mock gateways and temporary SQLite; no real Codex calls are allowed.
