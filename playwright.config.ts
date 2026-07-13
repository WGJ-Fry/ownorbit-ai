import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3333",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], serviceWorkers: "block" },
    },
  ],
  webServer: {
    command: "rm -rf .playwright-data && mkdir -p .playwright-data/icloud-drive && npm run build && LIFEOS_PORT=3333 LIFEOS_DATA_DIR=.playwright-data LIFEOS_FORCE_ICLOUD_HANDOFF=1 LIFEOS_ICLOUD_DRIVE_DIR=.playwright-data/icloud-drive LIFEOS_ICLOUD_ACCOUNT_STATUS=ready LIFEOS_ICLOUD_SYNC_SERVICE_STATUS=running node dist/server.cjs",
    url: "http://127.0.0.1:3333/api/v1/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
