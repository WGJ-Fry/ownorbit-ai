import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3333",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "rm -rf .playwright-data && npm run build && LIFEOS_PORT=3333 LIFEOS_DATA_DIR=.playwright-data node dist/server.cjs",
    url: "http://127.0.0.1:3333/api/v1/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
