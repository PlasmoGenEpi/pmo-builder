import { defineConfig, devices } from "@playwright/test";

// `E2E_PORT` lets several checkouts run the end-to-end tests at once, each
// against its own build. With it set, a server already on that port is never
// reused, since it could be serving another checkout.
const chosenPort = process.env["E2E_PORT"];
const port = chosenPort === undefined ? 4173 : Number(chosenPort);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env["CI"] && chosenPort === undefined,
    timeout: 120_000,
  },
});
