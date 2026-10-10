import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the editor in a browser. Native file dialogs are
// replaced by the browser storage adapter (download / file chooser).
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:1420", viewport: { width: 1400, height: 900 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } },
    // WebKit is the engine behind the macOS desktop build.
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1400, height: 900 } } },
  ],
  webServer: { command: "npm run dev", url: "http://localhost:1420", reuseExistingServer: true },
});
