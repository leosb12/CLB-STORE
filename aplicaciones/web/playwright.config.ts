import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./pruebas/navegador",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    baseURL: process.env["CLB_PWA_BASEURL"] ?? "http://127.0.0.1:14200",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run previsualizar",
    url: process.env["CLB_PWA_BASEURL"] ?? "http://127.0.0.1:14200",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
});
