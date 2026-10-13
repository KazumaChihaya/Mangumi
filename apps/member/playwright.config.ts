import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
  webServer: {
    command: "node ../../scripts/serve.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 20000,
  },
});
