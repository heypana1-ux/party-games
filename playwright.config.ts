import { defineConfig, devices } from "@playwright/test";

/*
  Party games are played on phones, so the E2E suite only ever runs on phone
  viewports. Several browser contexts stand in for several people in the room.

  Both projects are Chromium: the iOS-shaped one uses an iPhone viewport rather
  than the WebKit device descriptor, so the suite runs anywhere Chromium is
  available (CI images and this container included). Real Safari behaviour —
  the moving browser bars that `100dvh` and the safe-area padding exist for —
  still needs checking on a device before release.
*/
/*
  Some CI images ship a Chromium that does not match the build this Playwright
  version would download. Point PLAYWRIGHT_CHROMIUM_PATH at the existing binary
  in that case; left unset, Playwright resolves its own as usual.
*/
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

const phone = {
  ...devices["Desktop Chrome"],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // `||`, not `??`: an empty E2E_BASE_URL must fall back, not become the base URL.
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "on-first-retry",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "iphone-viewport", use: phone },
    { name: "android", use: { ...devices["Pixel 5"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
