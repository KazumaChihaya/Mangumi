import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/live",
  outputDir: "./test-results-live",
  timeout: 240000,
  workers: 1,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4193",
    actionTimeout: 15000,
    navigationTimeout: 20000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: "pnpm --filter @mangumi/api exec tsx tests/browser-server.ts",
    cwd: "../..",
    url: "http://127.0.0.1:4193/api/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
