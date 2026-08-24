import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const production = process.env.ROWER_TEST_PRODUCTION === "1";
const baseURL = production ? "http://127.0.0.1:4173" : "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./test/browser", fullyParallel: false,
  use: {
    baseURL, trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : undefined) }
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } }
  ],
  webServer: { command: production ? "pnpm preview" : "pnpm dev", url: baseURL, reuseExistingServer: !process.env.CI }
});
