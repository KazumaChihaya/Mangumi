import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pages",
  outputDir: "./test-results-pages",
  timeout: 240000,
  expect: { timeout: 10000 },
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:4183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
  webServer: {
    command: "node ../../scripts/serve.mjs --pages",
    url: "http://127.0.0.1:4183/Mangumi/",
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
