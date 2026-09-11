import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { seedHostedBillingMemberForTest, readHostedBrowserAuthPrincipalForTest } from "#hosted-web-testing";
import { removeHostedBrowserAuthEnvironment, requireHostedBrowserAuthConfig } from "@murphai/hosted-local-harness/browser-auth-live-config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHostedLocalFullStackScenario, type HostedLocalFullStackScenario } from "./helpers/hosted-local-full-stack-scenario.js";
import { startHostedBrowserHttps } from "./helpers/hosted-browser-https.js";

const config = requireHostedBrowserAuthConfig(process.env);
const localDatabaseUrl = process.env.DATABASE_URL?.trim();
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const browserOrigin = "https://localhost:3443";
let scenario: HostedLocalFullStackScenario | undefined;
let https: Awaited<ReturnType<typeof startHostedBrowserHttps>> | undefined;

// The account belongs to a dedicated Privy development app. Only existing active
// entitlement is seeded: no consent, session, cookie or application response is forged.
describe("hosted real-provider browser auth journey", () => {
  beforeAll(async () => {
    try {
      removeHostedBrowserAuthEnvironment(process.env);
      const privyUserId = await readHostedBrowserAuthPrincipalForTest(config);
      scenario = await startHostedLocalFullStackScenario({
        localDatabaseUrl,
        persistDirPrefix: "murph-browser-auth-",
        requiredRunnerEnvProfile: "assistant",
        scenarioLabel: "Real browser authentication and persistence",
        streamLogs: false,
        additionalEnv: {
          MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
          MURPH_DEV_TEMPORAL: "disabled",
          MURPH_DEV_WEB_HOST: "localhost",
          NEXT_PUBLIC_PRIVY_APP_ID: config.appId,
        },
        webProcessEnvOverrides: {
          HOSTED_BETTER_AUTH_ENABLED: "false",
          HOSTED_ONBOARDING_PUBLIC_BASE_URL: browserOrigin,
          HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS: browserOrigin,
          HOSTED_WEB_BASE_URL: browserOrigin,
          NEXT_PUBLIC_PRIVY_APP_ID: config.appId,
          PRIVY_APP_ID: config.appId,
          PRIVY_APP_SECRET: config.appSecret,
          PRIVY_VERIFICATION_KEY: config.verificationKey,
        },
      });
      if (!scenario.harness.webUsesProductionArtifact) {
        throw new Error("Browser auth requires a prepared production Web build.");
      }
      await seedHostedBillingMemberForTest({
        billingStatus: "active",
        environment: scenario.runtimeEnv,
        memberId: `member_browser_auth_${randomUUID().replaceAll("-", "")}`,
        previouslyActivated: true,
        privyUserId,
        verifiedEmail: config.email,
      });
      https = await startHostedBrowserHttps({ upstream: scenario.harness.webBaseUrl });
    } catch {
      throw new Error("Browser auth setup failed; verify the dedicated provider test account, production build, fixture and local TLS port. Private details are withheld.");
    }
  }, 600_000);

  afterAll(async () => {
    try {
      try { await https?.stop(); } finally { await scenario?.stop(); }
    } catch { throw new Error("Browser auth teardown failed; private details are withheld."); }
  }, 120_000);

  it("signs in through Privy, accepts consent, persists Settings, reloads and revokes access", async () => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "LANG"] as const) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const { stdout } = await promisify(execFile)("pnpm", ["--dir", "apps/web", "exec", "tsx", "scripts/run-hosted-browser-auth-journey.ts"], {
      cwd: repoRoot,
      env: { ...env, MURPH_E2E_AUTH_TEST_EMAIL: config.email, MURPH_E2E_AUTH_TEST_OTP: config.otp },
      maxBuffer: 32_000,
      timeout: 300_000,
    }).catch((error: unknown) => {
      const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
      const stage = /Browser auth journey failed: stage=(configuration|anonymous|provider_login|app_completion|consent|settings_write|reload|logout|revocation)\./u.exec(stderr)?.[1] ?? "browser_process";
      throw new Error(`Browser authentication journey failed at ${stage}; provider details are withheld.`);
    });
    expect(stdout.trim()).toBe("MURPH_E2E_AUTH_RESULT=passed");
  }, 360_000);
});
