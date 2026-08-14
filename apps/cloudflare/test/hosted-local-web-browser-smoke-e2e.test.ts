import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { seedHostedLaunchConsentForTest } from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runId = Date.now();
const userId = `member_local_web_browser_${runId}`;
const privyUserId = `did:privy:member_local_web_browser_${runId}`;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local authenticated web browser smoke e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        DEVICE_SYNC_SECRET: "synthetic-device-sync-runtime-secret",
        JUNCTION_API_KEY: "sk_us_junction-test",
        JUNCTION_CLIENT_USER_ID_SECRET:
          "junction-client-user-id-secret-value",
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "whoop_v2",
        JUNCTION_REGION: "us",
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_DEV_TEMPORAL: "disabled",
        MURPH_DEV_WEB_HOST: "localhost",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-web-browser-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted authenticated web browser e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it(
    "renders a usable authenticated Connect surface at compact-touch and desktop widths",
    async () => {
      const activeScenario = requireScenario();
      await activeScenario.seedActiveHostedMember({ memberId: userId });
      await seedHostedLaunchConsentForTest({
        environment: activeScenario.runtimeEnv,
        memberId: userId,
      });
      const session = await activeScenario.issueHostedAppSession({
        memberId: userId,
        privyUserId,
      });
      const sessionCookie =
        `${session.cookieName}=${encodeURIComponent(session.cookieValue)}`;

      const { stdout } = await execFileAsync(
        "pnpm",
        [
          "--dir",
          "apps/web",
          "exec",
          "tsx",
          "scripts/run-hosted-local-browser-smoke.ts",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...buildBrowserProcessEnvironment(process.env),
            MURPH_E2E_BROWSER_TIMEOUT_MS: "120000",
            MURPH_E2E_HOSTED_SESSION_COOKIE: sessionCookie,
            MURPH_E2E_WEB_BASE_URL: activeScenario.harness.webBaseUrl,
          },
          maxBuffer: 1_000_000,
          timeout: 300_000,
        },
      );
      const marker = stdout
        .split(/\r?\n/u)
        .reverse()
        .find((line) => line.startsWith("MURPH_E2E_RESULT="));
      if (!marker) {
        throw new Error(
          "Hosted browser smoke did not return a result marker.",
        );
      }
      expect(
        JSON.parse(marker.slice("MURPH_E2E_RESULT=".length)),
      ).toEqual({
        cases: ["compact-touch", "desktop"],
        ok: true,
      });
    },
    360_000,
  );
});

function buildBrowserProcessEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const allowedKeys = [
    "CHROME_DEVEL_SANDBOX",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "PATH",
    "PLAYWRIGHT_BROWSERS_PATH",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
  ] as const;

  return Object.fromEntries(allowedKeys.flatMap((key) => {
    const value = source[key];
    return value === undefined ? [] : [[key, value]];
  }));
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted-local browser scenario was not initialized.");
  }
  return scenario;
}
