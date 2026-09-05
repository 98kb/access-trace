import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  webServer: {
    command: "python3 -m http.server 4173 --directory public/fixtures",
    url: "http://127.0.0.1:4173/clean.html",
    reuseExistingServer: true,
  },
});
