import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  globalSetup: "./tests/e2e-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    storageState: "test-results/.session.json",
  },
  webServer: {
    command:
      "npx concurrently -k 'tsx tests/e2e-server.ts' 'TASTEPRINT_WEB_PORT=3100 TASTEPRINT_API_PORT=3101 vite'",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
  },
});
