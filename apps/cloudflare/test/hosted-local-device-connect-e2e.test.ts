import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  normalizeJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";
import {
  JunctionClient,
} from "@murphai/device-syncd/providers/junction-client";
import {
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  createHostedMailboxAssistantInputId,
} from "@murphai/hosted-execution/assistant-identifiers";

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
const junctionProviderModuleSpecifier = new URL(
  "../../../packages/device-syncd/src/providers/junction.ts",
  import.meta.url,
).href;
const runId = Date.now();
const userId = `member_local_device_connect_${runId}`;
const planUsageUserId = `member_local_plan_usage_control_${runId}`;
const subscriptionUserId = `member_local_subscription_control_${runId}`;
const subscriptionThreadId = `telegram_direct_subscription_${runId}`;
const browserSessionUserId = `member_local_browser_session_${runId}`;
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
    // The hosted stack needs Junction authority, but never the human WHOOP
    // login. Capture those values at module load and exclude them from every
    // Web, Worker, runner, and Temporal child process started by the harness.
    const restoreWhoopLoginEnvironment = temporarilyRemoveProcessEnvironment([
      "MURPH_E2E_WHOOP_EMAIL",
      "MURPH_E2E_WHOOP_OTP",
      "MURPH_E2E_WHOOP_PASSWORD",
    ]);

    try {
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
          MURPH_DEV_WEB_HOST: "localhost",
        },
        localDatabaseUrl,
        persistDirOverride: workerPersistDirOverride,
        persistDirPrefix: "murph-hosted-local-device-connect-",
        requiredRunnerEnvProfile: "assistant",
        scenarioLabel: "Local hosted device connect and web-control e2e",
        streamLogs: streamDevLogs,
      });
    } finally {
      restoreWhoopLoginEnvironment();
    }
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it(
    "keeps Junction credentials in platform authority and creates a signed WHOOP connect link",
    async () => {
      await requireScenario().seedActiveHostedMember({ memberId: userId });
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
        JUNCTION_ENV: "sandbox",
        JUNCTION_PROVIDER_FILTER: "whoop_v2",
        JUNCTION_REGION: junctionConfig.region,
      });
      expect(
        runnerRuntime.platformEnv?.JUNCTION_API_KEY === junctionConfig.apiKey,
      ).toBe(true);
      expect(
        runnerRuntime.platformEnv?.JUNCTION_CLIENT_USER_ID_SECRET
          === junctionConfig.clientUserIdSecret,
      ).toBe(true);
      const forwardedEnv = runnerRuntime.forwardedEnv ?? {};
      const userEnv = runnerRuntime.userEnv ?? {};
      expect(forwardedEnv.JUNCTION_API_KEY).toBeUndefined();
      expect(forwardedEnv.JUNCTION_CLIENT_USER_ID_SECRET).toBeUndefined();
      expect(JSON.stringify(forwardedEnv).includes(junctionConfig.apiKey)).toBe(false);
      expect(
        JSON.stringify(forwardedEnv).includes(junctionConfig.clientUserIdSecret),
      ).toBe(false);
      expect(JSON.stringify(userEnv).includes(junctionConfig.apiKey)).toBe(false);
      expect(
        JSON.stringify(userEnv).includes(junctionConfig.clientUserIdSecret),
      ).toBe(false);
      expect(Boolean(requireScenario().runtimeEnv.MURPH_E2E_WHOOP_EMAIL)).toBe(false);
      expect(Boolean(requireScenario().runtimeEnv.MURPH_E2E_WHOOP_OTP)).toBe(false);
      expect(Boolean(requireScenario().runtimeEnv.MURPH_E2E_WHOOP_PASSWORD)).toBe(false);

      const connectLink = await createHostedWhoopConnectLink(userId);

      // The runtime port surfaces the user-facing connect target. The
      // Junction implementation is asserted independently in resolvedConfig.
      expect(connectLink).toMatchObject({
        provider: "whoop",
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
      expect(
        (connectLink?.authorizationUrl ?? "").includes(junctionConfig.apiKey),
      ).toBe(false);
      expect(
        (connectLink?.authorizationUrl ?? "").includes(
          junctionConfig.clientUserIdSecret,
        ),
      ).toBe(false);
      expect(requireScenario().harness.stderrTail()).not.toContain(
        "No device sync providers are configured",
      );
    },
    300_000,
  );

  it(
    "reads plan usage through the real signed runner-to-Web control plane",
    async () => {
      await requireScenario().seedActiveHostedMember({
        billingPlanCode: "launch_monthly",
        memberId: planUsageUserId,
        stripeCustomerId: `cus_local_plan_usage_${runId}`,
        stripeSubscriptionId: `sub_local_plan_usage_${runId}`,
      });
      const planUsagePort = buildRuntimePlatform(planUsageUserId).planUsageToolPort;
      if (!planUsagePort) {
        throw new Error("Hosted plan-usage port was not configured.");
      }

      await expect(planUsagePort.read({})).resolves.toMatchObject({
        accessKind: "paid",
        planCode: "launch_monthly",
        planName: "Pulse",
        status: "active",
      });
    },
    300_000,
  );

  it(
    "binds rejected subscription actions to one real mailbox input across signed Web control",
    async () => {
      await requireScenario().seedActiveHostedMember({
        billingPlanCode: "launch_monthly",
        memberId: subscriptionUserId,
        stripeCustomerId: `cus_local_subscription_${runId}`,
        stripeSubscriptionId: `sub_local_subscription_${runId}`,
      });
      const wake = buildHostedExecutionTelegramConversationMessageWake({
        eventId:
          `telegram.message.received:local:${subscriptionUserId}:subscription-control`,
        occurredAt: new Date().toISOString(),
        telegramMessage: {
          messageId: `telegram_subscription_message_${runId}`,
          schema: "murph.hosted-telegram-message.v1",
          text: "Keep my Pulse subscription active.",
          threadId: subscriptionThreadId,
        },
        userId: subscriptionUserId,
      });
      await requireScenario().enqueueWake(wake, subscriptionUserId);
      const assistantInputId = createHostedMailboxAssistantInputId({
        dedupeKey: wake.eventId,
        eventId: wake.eventId,
        lane: "conversation",
        secret: subscriptionThreadId,
        userId: subscriptionUserId,
      });
      const subscriptionPort = buildRuntimePlatform(subscriptionUserId)
        .subscriptionToolPort;
      if (!subscriptionPort) {
        throw new Error("Hosted subscription port was not configured.");
      }
      const request = {
        action: "continue_pulse" as const,
        assistantInputId,
      };

      await expect(subscriptionPort.request(request)).rejects.toMatchObject({
        code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
        status: 409,
        statusCode: 409,
      });
      await expect(subscriptionPort.request(request)).rejects.toMatchObject({
        code: "HOSTED_PULSE_TRIAL_START_PAID_UNSUPPORTED",
        status: 409,
        statusCode: 409,
      });
      await expect(subscriptionPort.request({
        action: "upgrade_edge",
        assistantInputId,
      })).rejects.toMatchObject({
        code: "HOSTED_SUBSCRIPTION_INPUT_ACTION_CONFLICT",
        status: 409,
        statusCode: 409,
      });
    },
    300_000,
  );

  it(
    "mints the browser session through harness authority and accepts consent over Web",
    async () => {
      await requireScenario().seedActiveHostedMember({ memberId: browserSessionUserId });
      const sessionCookie = await issueHostedBrowserSession({
        memberId: browserSessionUserId,
      });
      const statusResponse = await fetch(
        `${requireScenario().harness.webBaseUrl}/api/legal/consent/status`,
        { headers: { cookie: sessionCookie } },
      );

      expect(statusResponse.status).toBe(200);
      expect(requireScenario().runtimeEnv.MURPH_DEV_WEB_HOST).toBe("localhost");
    },
    300_000,
  );

  // The default scenario remains hermetic. This opt-in branch uses one real
  // Junction sandbox user and WHOOP account, and must run as the only selected
  // hosted-local scenario so no unrelated process inherits its credentials.
  it.runIf(Boolean(liveJunctionWhoopConfig))(
    "connects WHOOP through Junction Link in a real browser and reloads persisted state",
    async () => {
      const liveConfig = requireLiveJunctionWhoopConfig();
      await resetLiveJunctionWhoopProvider(liveConfig);
      await requireScenario().seedActiveHostedMember({
        memberId: liveBrowserUserId,
      });
      const hostedSessionCookie = await issueHostedBrowserSession({
        memberId: liveBrowserUserId,
      });
      const connectLink = await createHostedWhoopConnectLink(liveBrowserUserId);
      if (!connectLink) {
        throw new Error("Hosted device-sync port did not create a WHOOP connect link.");
      }
      const result = await runJunctionWhoopBrowser({
        config: liveConfig,
        hostedSessionCookie,
        startUrl: connectLink.authorizationUrl,
        webBaseUrl: requireScenario().harness.webBaseUrl,
      }).finally(async () => {
        await resetLiveJunctionWhoopProvider(liveConfig);
      });

      expect(result).toEqual({
        callbackAutoCompleted: true,
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
  callbackAutoCompleted: true;
  connectedAfterCallback: true;
  connectedAfterReload: true;
  disconnectedDuringCleanup: true;
  provider: "junction";
  source: "whoop";
}

interface JunctionProviderModule {
  buildJunctionClientUserId(secret: string, ownerId: string): string;
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

async function createHostedWhoopConnectLink(memberId: string) {
  const platform = buildRuntimePlatform(memberId);
  return await platform.deviceSyncPort?.createConnectLink({
    messagingReturnTarget: "telegram",
    connectTarget: "whoop",
  });
}

function buildRuntimePlatform(boundUserId: string) {
  const hostedExecutionEnvironment = readHostedExecutionEnvironment(
    requireHostedWorkerRuntimeEnv(),
  );
  return buildHostedExecutionRuntimePlatform({
    boundUserId,
    webCallbackSigning: hostedExecutionEnvironment.webCallbackSigning,
    webControlBaseUrl: requireScenario().harness.webBaseUrl,
  });
}

async function resetLiveJunctionWhoopProvider(
  config: LiveJunctionWhoopConfig,
): Promise<void> {
  const client = new JunctionClient({
    apiKey: config.apiKey,
    environment: "sandbox",
    region: config.region,
  });
  const junctionProvider = await import(
    junctionProviderModuleSpecifier
  ) as JunctionProviderModule;
  const clientUserId = junctionProvider.buildJunctionClientUserId(
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
  memberId: string;
}): Promise<string> {
  const session = await requireScenario().issueHostedAppSession({
    memberId: input.memberId,
    privyUserId: `did:privy:${input.memberId}`,
  });
  const cookie = `${session.cookieName}=${encodeURIComponent(session.cookieValue)}`;
  await acceptHostedLaunchConsents({
    sessionCookie: cookie,
    webBaseUrl: requireScenario().harness.webBaseUrl,
  });
  return cookie;
}

async function acceptHostedLaunchConsents(input: {
  sessionCookie: string;
  webBaseUrl: string;
}): Promise<void> {
  const statusResponse = await fetch(`${input.webBaseUrl}/api/legal/consent/status`, {
    headers: { cookie: input.sessionCookie },
  });
  const status = await statusResponse.json() as {
    scopes?: Array<{
      documents: Array<{ id: string; version: string }>;
      scope: string;
    }>;
  };
  if (statusResponse.status !== 200) {
    throw new Error(`Hosted consent status failed: ${JSON.stringify(status)}`);
  }

  for (const scope of ["launch.legal", "launch.health-data"]) {
    const scopeStatus = status.scopes?.find((candidate) => candidate.scope === scope);
    if (!scopeStatus) {
      throw new Error(`Hosted consent status did not include scope ${scope}.`);
    }
    const acceptedDocumentVersions = Object.fromEntries(
      scopeStatus.documents.map((document) => [document.id, document.version]),
    );
    const acceptResponse = await fetch(`${input.webBaseUrl}/api/legal/consent/accept`, {
      body: JSON.stringify({
        acceptedDocumentVersions,
        scope,
        source: "hosted-local-e2e",
      }),
      headers: {
        "content-type": "application/json",
        cookie: input.sessionCookie,
        origin: input.webBaseUrl,
      },
      method: "POST",
    });
    if (acceptResponse.status !== 200) {
      throw new Error(
        `Hosted consent accept for ${scope} failed: ${await acceptResponse.text()}`,
      );
    }
  }
}

function temporarilyRemoveProcessEnvironment(keys: readonly string[]): () => void {
  const previousValues = new Map<string, string | undefined>();

  for (const key of keys) {
    previousValues.set(key, process.env[key]);
    delete process.env[key];
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
  startUrl: string;
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
      encoding: "utf8",
      env: {
        ...buildBrowserProcessEnvironment(),
        MURPH_E2E_CONNECT_URL: input.startUrl,
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
    .reverse()
    .find((line) => line.startsWith("MURPH_E2E_RESULT="));
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
    "MURPH_E2E_CONNECT_URL",
    "MURPH_E2E_HOSTED_SESSION_COOKIE",
    "MURPH_E2E_WEB_BASE_URL",
    "MURPH_E2E_WHOOP_EMAIL",
    "MURPH_E2E_WHOOP_HEADLESS",
    "MURPH_E2E_WHOOP_OTP",
    "MURPH_E2E_WHOOP_PASSWORD",
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
