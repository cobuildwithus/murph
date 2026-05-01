import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
} from "./hosted-execution-fixtures.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";

const userId = `member_local_device_connect_${Date.now()}`;
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const deviceSyncPublicBaseUrl = "https://device-sync.example.test/api/device-sync";
const whoopBaseUrl = "https://whoop-oauth.example.test";
const whoopClientId = "synthetic-whoop-client";
const whoopClientSecret = "synthetic-whoop-secret";
const hostedWebCallbackPublicKeyringJson =
  `{"v1":${TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON}}`;

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
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON: hostedWebCallbackPublicKeyringJson,
        HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "v1",
        MURPH_DEV_USE_REMOTE_HOSTED_CRYPTO_KEYS: "1",
        WHOOP_BASE_URL: whoopBaseUrl,
        WHOOP_CLIENT_ID: whoopClientId,
        WHOOP_CLIENT_SECRET: whoopClientSecret,
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-device-connect-",
      requiredRunnerEnvProfile: "assistant",
      scenarioLabel: "Local hosted device connect e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

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

    expect(runnerRuntime.resolvedConfig?.deviceSync).toMatchObject({
      providerConfigs: {
        whoop: {
          baseUrl: whoopBaseUrl,
          clientId: whoopClientId,
          clientSecret: whoopClientSecret,
        },
      },
      publicBaseUrl: deviceSyncPublicBaseUrl,
      secret: "synthetic-device-sync-runtime-secret",
    });
    const forwardedEnv = runnerRuntime.forwardedEnv ?? {};
    const userEnv = runnerRuntime.userEnv ?? {};
    expect(forwardedEnv.WHOOP_CLIENT_ID).toBeUndefined();
    expect(forwardedEnv.WHOOP_CLIENT_SECRET).toBeUndefined();
    expect(JSON.stringify(forwardedEnv)).not.toContain(whoopClientSecret);
    expect(JSON.stringify(userEnv)).not.toContain(whoopClientSecret);

    const platform = buildHostedExecutionRuntimePlatform({
      boundUserId: userId,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
      webControlBaseUrl: requireScenario().harness.webBaseUrl,
    });
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
    expect(authorizationUrl.origin).toBe(whoopBaseUrl);
    expect(authorizationUrl.pathname).toBe("/oauth/oauth2/auth");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(whoopClientId);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      `${deviceSyncPublicBaseUrl}/oauth/whoop/callback`,
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("state")).toEqual(expect.any(String));
    expect(authorizationUrl.searchParams.has("client_secret")).toBe(false);
    expect(connectLink?.authorizationUrl).not.toContain(whoopClientSecret);
    expect(requireScenario().harness.stderrTail()).not.toContain(
      "No device sync providers are configured",
    );
  }, 300_000);
});

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}
