import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const runId = Date.now();
const userId = `member_local_device_connect_${runId}`;
const planUsageUserId = `member_local_plan_usage_control_${runId}`;
const subscriptionUserId = `member_local_subscription_control_${runId}`;
const subscriptionThreadId = `telegram_direct_subscription_${runId}`;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const whoopBaseUrl = "https://whoop-oauth.example.test";
const whoopClientId = "synthetic-whoop-client";
const whoopClientSecret = "synthetic-whoop-secret";

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
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        WHOOP_BASE_URL: whoopBaseUrl,
        WHOOP_CLIENT_ID: whoopClientId,
        WHOOP_CLIENT_SECRET: whoopClientSecret,
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-device-connect-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted device connect and web-control e2e",
      streamLogs: streamDevLogs,
    });
  }, 600_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
  }, 120_000);

  it("keeps WHOOP credentials in hosted config and creates a signed hosted connect link", async () => {
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
        whoop: {
          baseUrl: whoopBaseUrl,
          clientId: whoopClientId,
          clientSecret: whoopClientSecret,
        },
      },
      publicBaseUrl: localDeviceSyncPublicBaseUrl,
      secret: "synthetic-device-sync-runtime-secret",
    });
    const forwardedEnv = runnerRuntime.forwardedEnv ?? {};
    const userEnv = runnerRuntime.userEnv ?? {};
    expect(forwardedEnv.WHOOP_CLIENT_ID).toBeUndefined();
    expect(forwardedEnv.WHOOP_CLIENT_SECRET).toBeUndefined();
    expect(JSON.stringify(forwardedEnv)).not.toContain(whoopClientSecret);
    expect(JSON.stringify(userEnv)).not.toContain(whoopClientSecret);

    const platform = buildRuntimePlatform(userId);
    const connectLink = await platform.deviceSyncPort?.createConnectLink({
      messagingReturnTarget: "telegram",
      connectTarget: "whoop",
    });

    expect(connectLink).toMatchObject({
      provider: "whoop",
      providerLabel: "WHOOP",
    });
    expect(connectLink?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    const authorizationUrl = new URL(connectLink?.authorizationUrl ?? "");
    expect(authorizationUrl.origin).toBe(requireScenario().harness.webBaseUrl);
    expect(authorizationUrl.pathname).toBe("/connect");
    expect(authorizationUrl.search).toBe("");
    const authorizationFragment = new URLSearchParams(authorizationUrl.hash.slice(1));
    expect(authorizationFragment.get("deviceConnectIntent")).toMatch(
      /^dc_[A-Za-z0-9_-]{32}$/u,
    );
    expect(authorizationFragment.get("connectSource")).toBe("whoop");
    expect(connectLink?.authorizationUrl).not.toContain(whoopClientSecret);
    expect(requireScenario().harness.stderrTail()).not.toContain(
      "No device sync providers are configured",
    );
  }, 300_000);

  it("reads plan usage through the real signed runner-to-Web control plane", async () => {
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
  }, 300_000);

  it("binds rejected subscription actions to one real mailbox input across signed Web control", async () => {
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
  }, 300_000);
});

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
