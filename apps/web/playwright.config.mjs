import { defineConfig, devices } from "@playwright/test";

const bindHost = process.env.PLAYWRIGHT_BIND_HOST || "127.0.0.1";
const bindPort = process.env.PLAYWRIGHT_BIND_PORT || "3000";
const defaultBaseUrl = process.env.PLAYWRIGHT_BASE_URL || `http://${bindHost}:${bindPort}`;
const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(defaultBaseUrl);
const webServerConfig = isLocalTarget
  ? {
      command: `bun run dev -- --hostname ${bindHost} --port ${bindPort}`,
      url: `http://${bindHost}:${bindPort}`,
      reuseExistingServer: true,
      timeout: 120_000,
    }
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: defaultBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: webServerConfig,
  reporter: [["list"]],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
