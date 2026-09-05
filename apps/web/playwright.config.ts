import { defineConfig } from "@playwright/test";

import { createHostedWebSmokeEnvironment } from "./next-artifacts";

// Deterministic browser-test gate. Playwright owns the dev-server lifecycle via
// `webServer`, booting hosted-web with the same placeholder environment the
// smoke lane uses (`createHostedWebSmokeEnvironment`) so public pages render
// without real secrets, auth, or a database. The viewport package command
// prepares generated inputs before Playwright starts its readiness deadline;
// direct config consumers keep the self-preparing server command.
//
// The server uses its own dist dir suffix (`.next-smoke-overflow`) so it never
// contends with the concurrent `dev:smoke` lock in `apps/web verify`.

const host = "127.0.0.1";
const port = Number.parseInt(process.env.VIEWPORT_OVERFLOW_PORT ?? "3210", 10);
const baseURL = `http://${host}:${port}`;
const devCommand =
  process.env.MURPH_PLAYWRIGHT_GENERATED_INPUTS_PREPARED === "1"
    ? "dev:prepared-local-env"
    : "dev:local-env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // A single retry absorbs dev-server first-compile timing flake without
  // masking a real overflow, which fails deterministically on every attempt.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The HTML report is what the CI workflow uploads as a failure artifact.
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    reducedMotion: "reduce",
    trace: "off",
  },
  // Bundled Chromium only (no `channel`), so `playwright install chromium` in
  // CI is sufficient — no dependency on a system Google Chrome install.
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `pnpm ${devCommand} --hostname ${host} --port ${port}`,
    url: `${baseURL}/api/internal/health`,
    env: {
      ...createHostedWebSmokeEnvironment(process.env),
      HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED: "1",
      HOSTED_USAGE_REFERRALS_ENABLED: "1",
      NEXT_DIST_DIR_SUFFIX: process.env.NEXT_DIST_DIR_SUFFIX ?? "overflow",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
