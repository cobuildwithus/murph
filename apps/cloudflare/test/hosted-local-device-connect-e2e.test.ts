import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildJunctionClientUserId,
  JunctionClient,
  normalizeJunctionProviderSlug,
} from "@murphai/device-syncd";

import {
  readHostedExecutionEnvironment,
} from "../src/env.ts";
import {
  buildHostedExecutionRuntimePlatform,
} from "../src/runtime-platform.ts";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "../src/runner-env.js";
import {
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
} from "./hosted-execution-fixtures.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const linkUserId = `member_local_device_connect_${Date.now()}`;
const liveBrowserUserId =
  process.env.MURPH_E2E_JUNCTION_WHOOP_MEMBER_ID?.trim()
  || "member_e2e_junction_whoop_browser";
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride =
  process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const syntheticJunctionConfig = {
  apiKey: "sk_us_junction-test",
  clientUserIdSecret: "junction-client-user-id-secret-value",
  region: "us" as const,
};
const liveJunctionWhoopConfig = readLiveJunctionWhoopConfig(process.env);
const junctionConfig = liveJunctionWhoopConfig ?? syntheticJunctionConfig;

let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local device connect e2e", () => {
  beforeAll(async () => {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: deviceSyncPublicBaseUrl,
        DEVICE_SYNC_SECRET: "synthetic-device-sync-runtime-secret",
        HOSTED_CRYPTO_ENV: "test",
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
          TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
        HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
          TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
        HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
          "projects/test/locations/global/keyRings/ring/cryptoKeys/web-wrap",
        JUNCTION_API_KEY: junctionConfig.apiKey,
        JUNCTION_CLIENT_USER_ID_SECRET: junctionConfig.clientUserIdSecret,
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "whoop_v2",
        JUNCTION_REGION: junctionConfig.region,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-device-connect-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted device connect e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it(
    "keeps Junction credentials in platform authority and creates a signed WHOOP connect link",
    async () => {
      await requireScenario().seedActiveHostedMember({ memberId: linkUserId });
      const runnerRuntime = buildHostedRunnerJobRuntimeConfig({
        configSource: requireScenario().runtimeEnv,
        forwardedEnv: buildHostedRunnerContainerEnv(requireScenario().runtimeEnv),
        runnerSecrets: {},
      });
      const localDeviceSyncPublicBaseUrl =
        `${requireScenario().harness.webBaseUrl}/api/device-sync`;
      expect(localDeviceSyncPublicBaseUrl).not.toBe(deviceSyncPublicBaseUrl);

      expect(runnerRuntime.resolvedConfig?.deviceSync).toMatchObject({
        providerConfigs: {
          junction: {
            environment: "sandbox",
            providerFilter: ["whoop_v2"],
            region: junctionConfig.region,
          },
        },
        publicBaseUrl: localDeviceSyncPublicBaseUrl,
        secret: "synthetic-device-sync-runtime-secret",
      });
      const serializableJunctionConfig =
        runnerRuntime.resolvedConfig?.deviceSync?.providerConfigs.junction;
      expect(serializableJunctionConfig).not.toHaveProperty("apiKey");
      expect(serializableJunctionConfig).not.toHaveProperty("clientUserIdSecret");
      expect(
        runnerRuntime.resolvedConfig?.deviceSync?.providerConfigs,
      ).not.toHaveProperty("whoop");
      expect(runnerRuntime.platformEnv).toMatchObject({
        JUNCTION_API_KEY: junctionConfig.apiKey,
        JUNCTION_CLIENT_USER_ID_SECRET: junctionConfig.clientUserIdSecret,
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "whoop_v2",
        JUNCTION_REGION: junctionConfig.region,
      });
      const forwardedEnv = runnerRuntime.forwardedEnv ?? {};
      const userEnv = runnerRuntime.userEnv ?? {};
      expect(forwardedEnv.JUNCTION_API_KEY).toBeUndefined();
      expect(forwardedEnv.JUNCTION_CLIENT_USER_ID_SECRET).toBeUndefined();
      expect(JSON.stringify(forwardedEnv)).not.toContain(junctionConfig.apiKey);
      expect(JSON.stringify(forwardedEnv)).not.toContain(
        junctionConfig.clientUserIdSecret,
      );
      expect(JSON.stringify(userEnv)).not.toContain(junctionConfig.apiKey);
      expect(JSON.stringify(userEnv)).not.toContain(
        junctionConfig.clientUserIdSecret,
      );

      const hostedExecutionEnvironment = readHostedExecutionEnvironment(
        requireHostedWorkerRuntimeEnv(),
      );
      const platform = buildHostedExecutionRuntimePlatform({
        boundUserId: linkUserId,
        webCallbackSigning: hostedExecutionEnvironment.webCallbackSigning,
        webControlBaseUrl: requireScenario().harness.webBaseUrl,
      });
      const connectLink = await platform.deviceSyncPort?.createConnectLink({
        messagingReturnTarget: "telegram",
        connectTarget: "whoop",
      });

      expect(connectLink).toMatchObject({
        provider: "junction",
        providerLabel: "WHOOP",
      });
      expect(connectLink?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      const authorizationUrl = new URL(connectLink?.authorizationUrl ?? "");
      expect(authorizationUrl.origin).toBe(requireScenario().harness.webBaseUrl);
      expect(authorizationUrl.pathname).toBe("/connect");
      expect(authorizationUrl.search).toBe("");
      const authorizationFragment = new URLSearchParams(
        authorizationUrl.hash.slice(1),
      );
      expect(authorizationFragment.get("deviceConnectIntent")).toMatch(
        /^dc_[A-Za-z0-9_-]{32}$/u,
      );
      expect(authorizationFragment.get("connectSource")).toBe("whoop");
      expect(connectLink?.authorizationUrl).not.toContain(junctionConfig.apiKey);
      expect(connectLink?.authorizationUrl).not.toContain(
        junctionConfig.clientUserIdSecret,
      );
      expect(requireScenario().harness.stderrTail()).not.toContain(
        "No device sync providers are configured",
      );
    },
    300_000,
  );

  // The default scenario remains hermetic. This opt-in branch uses one real
  // Junction sandbox user and WHOOP account, and must run as the only selected
  // hosted-local scenario so its temporary Prisma client cannot affect peers.
  it.runIf(Boolean(liveJunctionWhoopConfig))(
    "connects WHOOP through Junction Link in a real browser and reloads persisted state",
    async () => {
      assertLiveScenarioIsIsolated();
      const liveConfig = requireLiveJunctionWhoopConfig();
      await resetLiveJunctionWhoopProvider(liveConfig);
      await requireScenario().seedActiveHostedMember({
        memberId: liveBrowserUserId,
      });
      const hostedSessionCookie = await issueHostedBrowserSession({
        environment: requireScenario().runtimeEnv,
        memberId: liveBrowserUserId,
      });
      const result = await runJunctionWhoopBrowser({
        config: liveConfig,
        hostedSessionCookie,
        webBaseUrl: requireScenario().harness.webBaseUrl,
      });

      expect(result).toEqual({
        callbackConfirmed: true,
        connectedAfterCallback: true,
        connectedAfterReload: true,
        disconnectedDuringCleanup: true,
        provider: "junction",
        source: "whoop",
      });
    },
    600_000,
  );
});

interface LiveJunctionWhoopConfig {
  apiKey: string;
  clientUserIdSecret: string;
  email: string;
  headless: boolean;
  otp: string | null;
  password: string;
  region: "eu" | "us";
}

interface JunctionWhoopBrowserResult {
  callbackConfirmed: true;
  connectedAfterCallback: true;
  connectedAfterReload: true;
  disconnectedDuringCleanup: true;
  provider: "junction";
  source: "whoop";
}

function readLiveJunctionWhoopConfig(
  env: NodeJS.ProcessEnv,
): LiveJunctionWhoopConfig | null {
  if (env.MURPH_E2E_JUNCTION_WHOOP_LIVE !== "1") {
    return null;
  }

  const environment = requireLiveEnvironmentValue(env, "JUNCTION_ENV");
  if (environment !== "sandbox") {
    throw new Error("Live Junction WHOOP E2E requires JUNCTION_ENV=sandbox.");
  }
  const region = requireLiveEnvironmentValue(env, "JUNCTION_REGION");
  if (region !== "us" && region !== "eu") {
    throw new Error("Live Junction WHOOP E2E requires JUNCTION_REGION=us or eu.");
  }
  const apiKey = requireLiveEnvironmentValue(env, "JUNCTION_API_KEY");
  if (!apiKey.startsWith(`sk_${region}_`)) {
    throw new Error(
      `Live Junction WHOOP E2E requires a ${region} sandbox JUNCTION_API_KEY.`,
    );
  }

  return {
    apiKey,
    clientUserIdSecret: requireLiveEnvironmentValue(
      env,
      "JUNCTION_CLIENT_USER_ID_SECRET",
    ),
    email: requireLiveEnvironmentValue(env, "MURPH_E2E_WHOOP_EMAIL"),
    headless: env.MURPH_E2E_WHOOP_HEADLESS !== "0",
    otp: env.MURPH_E2E_WHOOP_OTP?.trim() || null,
    password: requireLiveEnvironmentValue(env, "MURPH_E2E_WHOOP_PASSWORD"),
    region,
  };
}

function requireLiveEnvironmentValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Live Junction WHOOP E2E requires ${key}.`);
  }
  return value;
}

function requireLiveJunctionWhoopConfig(): LiveJunctionWhoopConfig {
  if (!liveJunctionWhoopConfig) {
    throw new Error("Live Junction WHOOP E2E configuration was not enabled.");
  }
  return liveJunctionWhoopConfig;
}

function assertLiveScenarioIsIsolated(): void {
  const selectedE2eFiles = process.argv.filter((argument) =>
    argument.endsWith("e2e.test.ts")
  );
  if (selectedE2eFiles.length > 1) {
    throw new Error(
      "Run the live Junction WHOOP browser proof by itself: pnpm hosted-local e2e device-connect.",
    );
  }
}

async function resetLiveJunctionWhoopProvider(
  config: LiveJunctionWhoopConfig,
): Promise<void> {
  const client = new JunctionClient({
    apiKey: config.apiKey,
    environment: "sandbox",
    region: config.region,
  });
  const clientUserId = buildJunctionClientUserId(
    config.clientUserIdSecret,
    liveBrowserUserId,
  );
  const user = await client.resolveUser(clientUserId);
  if (!user) {
    return;
  }

  const providers = await client.listUserProviders(user.userId);
  const whoopConnected = providers.some((provider) => {
    const sourceProviderSlug = normalizeJunctionProviderSlug(
      provider.origin.sourceProviderSlug ?? provider.slug,
    );
    const status = normalizeJunctionProviderSlug(provider.status);
    return (sourceProviderSlug === "whoop_v2" || sourceProviderSlug === "whoop")
      && status !== "disconnected";
  });
  if (whoopConnected) {
    await client.deregisterProvider({
      providerSlug: "whoop_v2",
      userId: user.userId,
    });
  }
}

async function issueHostedBrowserSession(input: {
  environment: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<string> {
  const restoreEnvironment = applyProcessEnvironment(input.environment);

  try {
    const [consentModule, sessionModule, prismaModule] = await Promise.all([
      import("@/src/lib/legal/consent"),
      import("@/src/lib/hosted-onboarding/app-session"),
      import("@/src/lib/prisma"),
    ]);
    const prisma = prismaModule.getPrisma();

    try {
      await consentModule.recordHostedLaunchRequiredConsent({
        memberId: input.memberId,
        prisma,
        scope: "launch.legal",
        source: "hosted-local-junction-whoop-browser-e2e",
      });
      await consentModule.recordHostedLaunchRequiredConsent({
        memberId: input.memberId,
        prisma,
        scope: "launch.health-data",
        source: "hosted-local-junction-whoop-browser-e2e",
      });
      const session = await sessionModule.issueHostedAppSession({
        memberId: input.memberId,
        privyUserId: `did:privy:${input.memberId}`,
      });
      return session.cookie;
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    restoreEnvironment();
  }
}

function applyProcessEnvironment(environment: NodeJS.ProcessEnv): () => void {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(environment)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function runJunctionWhoopBrowser(input: {
  config: LiveJunctionWhoopConfig;
  hostedSessionCookie: string;
  webBaseUrl: string;
}): Promise<JunctionWhoopBrowserResult> {
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "exec",
      "tsx",
      "--tsconfig",
      "apps/web/tsconfig.json",
      "apps/web/scripts/run-hosted-local-junction-whoop-browser.ts",
    ],
    {
      cwd: repoRoot,
      env: {
        ...buildBrowserProcessEnvironment(),
        MURPH_E2E_HOSTED_SESSION_COOKIE: input.hostedSessionCookie,
        MURPH_E2E_WEB_BASE_URL: input.webBaseUrl,
        MURPH_E2E_WHOOP_EMAIL: input.config.email,
        MURPH_E2E_WHOOP_HEADLESS: input.config.headless ? "1" : "0",
        ...(input.config.otp ? { MURPH_E2E_WHOOP_OTP: input.config.otp } : {}),
        MURPH_E2E_WHOOP_PASSWORD: input.config.password,
      },
      maxBuffer: 1_000_000,
      timeout: 480_000,
    },
  );
  const marker = stdout
    .split(/\r?\n/u)
    .findLast((line) => line.startsWith("MURPH_E2E_RESULT="));
  if (!marker) {
    throw new Error("Junction WHOOP browser E2E did not return a result marker.");
  }

  return JSON.parse(
    marker.slice("MURPH_E2E_RESULT=".length),
  ) as JunctionWhoopBrowserResult;
}

function buildBrowserProcessEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of [
    "JUNCTION_API_KEY",
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "JUNCTION_WEBHOOK_SECRET",
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
  ]) {
    delete environment[key];
  }
  return environment;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}

function requireHostedWorkerRuntimeEnv(): NodeJS.ProcessEnv {
  const workerRuntimeEnv = requireScenario().harness.workerRuntimeEnv;

  if (!workerRuntimeEnv) {
    throw new Error("Hosted local worker runtime environment was not initialized.");
  }

  return workerRuntimeEnv;
}
