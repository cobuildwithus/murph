import assert from "node:assert/strict";
import { Console } from "node:console";
import { createHmac } from "node:crypto";
import { Writable } from "node:stream";
import { test } from "vitest";

import {
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  configuredDeviceSyncProviderKeys,
  createConsoleDeviceSyncLogger,
  createConfiguredDeviceSyncRegistry,
  deviceSyncProviderRuntimeSecretEnvKeys,
  deviceSyncProviderRuntimeVariableEnvKeys,
  hasConfiguredDeviceSyncProviderConfigs,
  listConfiguredDeviceSyncProviderNames,
  loadDeviceSyncEnvironment,
  parseSerializableConfiguredDeviceSyncProviderConfigs,
  readConfiguredDeviceSyncProviderConfigs,
  readConfiguredOuraDeviceSyncProviderConfig,
} from "../src/config.ts";
import { computeRetryDelayMs } from "../src/shared.ts";
import { createDeviceSyncEnv, requireValue } from "./helpers.ts";

test("computeRetryDelayMs uses the 15-second slot for the first retry", () => {
  assert.equal(computeRetryDelayMs(1), 15_000);
  assert.equal(computeRetryDelayMs(2), 60_000);
});

test("loadDeviceSyncEnvironment supports Oura-only deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    ...createDeviceSyncEnv(),
  });
  const providers = requireValue(loaded.service.providers);

  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.provider, "oura");
  assert.equal(loaded.http.host, "127.0.0.1");
  assert.equal(loaded.http.controlToken, "control-token-for-tests");
});

test("loadDeviceSyncEnvironment supports Garmin-only deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    GARMIN_CLIENT_ID: "garmin-client-id",
    GARMIN_CLIENT_SECRET: "garmin-client-secret",
    ...createDeviceSyncEnv(),
  });
  const providers = requireValue(loaded.service.providers);

  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.provider, "garmin");
});

test("loadDeviceSyncEnvironment supports mixed WHOOP and Oura deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    ...createDeviceSyncEnv(),
  });
  const providers = requireValue(loaded.service.providers);

  assert.deepEqual(
    providers.map((provider) => provider.provider),
    ["oura", "whoop"],
  );
});

test("loadDeviceSyncEnvironment supports Garmin, WHOOP, and Oura together", () => {
  const loaded = loadDeviceSyncEnvironment({
    GARMIN_CLIENT_ID: "garmin-client-id",
    GARMIN_CLIENT_SECRET: "garmin-client-secret",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    ...createDeviceSyncEnv(),
  });
  const providers = requireValue(loaded.service.providers);

  assert.deepEqual(
    providers.map((provider) => provider.provider),
    ["garmin", "oura", "whoop"],
  );
});

test("createConfiguredDeviceSyncRegistry assembles the configured providers in descriptor order", () => {
  const registry = createConfiguredDeviceSyncRegistry({
    GARMIN_CLIENT_ID: "garmin-client-id",
    GARMIN_CLIENT_SECRET: "garmin-client-secret",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.deepEqual(
    registry.list().map((provider) => provider.provider),
    ["garmin", "oura", "whoop"],
  );
});

test("configuredDeviceSyncProviderKeys follow the shared descriptor order", () => {
  assert.deepEqual(configuredDeviceSyncProviderKeys, ["garmin", "oura", "whoop"]);
});

test("shared provider-config helpers preserve descriptor order and report presence", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.equal(hasConfiguredDeviceSyncProviderConfigs({}), false);
  assert.equal(hasConfiguredDeviceSyncProviderConfigs(configs), true);
  assert.deepEqual(listConfiguredDeviceSyncProviderNames(configs), ["oura", "whoop"]);
});

test("shared provider runtime env key lists stay aligned with the configured providers", () => {
  assert.deepEqual(deviceSyncProviderRuntimeSecretEnvKeys, [
    "GARMIN_CLIENT_ID",
    "GARMIN_CLIENT_SECRET",
    "OURA_CLIENT_ID",
    "OURA_CLIENT_SECRET",
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
  ]);
  assert.deepEqual(deviceSyncProviderRuntimeVariableEnvKeys, [
    "GARMIN_API_BASE_URL",
    "GARMIN_AUTH_BASE_URL",
    "GARMIN_BACKFILL_DAYS",
    "GARMIN_RECONCILE_DAYS",
    "GARMIN_RECONCILE_INTERVAL_MS",
    "GARMIN_REQUEST_TIMEOUT_MS",
    "GARMIN_TOKEN_BASE_URL",
    "OURA_API_BASE_URL",
    "OURA_AUTH_BASE_URL",
    "OURA_BACKFILL_DAYS",
    "OURA_RECONCILE_DAYS",
    "OURA_RECONCILE_INTERVAL_MS",
    "OURA_REQUEST_TIMEOUT_MS",
    "OURA_SCOPES",
    "OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS",
    "WHOOP_BACKFILL_DAYS",
    "WHOOP_BASE_URL",
    "WHOOP_RECONCILE_DAYS",
    "WHOOP_RECONCILE_INTERVAL_MS",
    "WHOOP_REQUEST_TIMEOUT_MS",
    "WHOOP_SCOPES",
    "WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS",
  ]);
});

test("cloneSerializableConfiguredDeviceSyncProviderConfigs strips provider-only runtime fields", () => {
  const cloned = cloneSerializableConfiguredDeviceSyncProviderConfigs({
    garmin: {
      clientId: "garmin-client-id",
      clientSecret: "garmin-client-secret",
      fetchImpl: fetch,
    },
    oura: {
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      fetchImpl: fetch,
      scopes: ["daily", "heartrate"],
      webhookVerificationToken: "verify-token-for-tests",
    },
    whoop: {
      clientId: "whoop-client-id",
      clientSecret: "whoop-client-secret",
      fetchImpl: fetch,
      scopes: ["read:profile"],
    },
  });

  assert.deepEqual(cloned, {
    garmin: {
      clientId: "garmin-client-id",
      clientSecret: "garmin-client-secret",
    },
    oura: {
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      scopes: ["daily", "heartrate"],
    },
    whoop: {
      clientId: "whoop-client-id",
      clientSecret: "whoop-client-secret",
      scopes: ["read:profile"],
    },
  });
});

test("parseSerializableConfiguredDeviceSyncProviderConfigs parses the hosted runtime subset", () => {
  const parsed = parseSerializableConfiguredDeviceSyncProviderConfigs(
    {
      garmin: {
        apiBaseUrl: "https://garmin.example.test",
        authBaseUrl: "https://garmin-auth.example.test",
        backfillDays: 14,
        clientId: "garmin-client-id",
        clientSecret: "garmin-client-secret",
        reconcileDays: 7,
        reconcileIntervalMs: 3_600_000,
        requestTimeoutMs: 30_000,
        tokenBaseUrl: "https://garmin-token.example.test",
      },
      oura: {
        apiBaseUrl: "https://oura.example.test",
        authBaseUrl: "https://oura-auth.example.test",
        backfillDays: 21,
        clientId: "oura-client-id",
        clientSecret: "oura-client-secret",
        reconcileDays: 7,
        reconcileIntervalMs: 7_200_000,
        requestTimeoutMs: 30_000,
        scopes: ["daily", "heartrate"],
        webhookTimestampToleranceMs: 60_000,
      },
      whoop: {
        backfillDays: 30,
        baseUrl: "https://whoop.example.test",
        clientId: "whoop-client-id",
        clientSecret: "whoop-client-secret",
        reconcileDays: 14,
        reconcileIntervalMs: 10_800_000,
        requestTimeoutMs: 30_000,
        scopes: ["read:profile", "read:sleep"],
        webhookTimestampToleranceMs: 120_000,
      },
    },
    "runtime.providerConfigs",
  );

  assert.deepEqual(parsed, {
    garmin: {
      apiBaseUrl: "https://garmin.example.test",
      authBaseUrl: "https://garmin-auth.example.test",
      backfillDays: 14,
      clientId: "garmin-client-id",
      clientSecret: "garmin-client-secret",
      reconcileDays: 7,
      reconcileIntervalMs: 3_600_000,
      requestTimeoutMs: 30_000,
      tokenBaseUrl: "https://garmin-token.example.test",
    },
    oura: {
      apiBaseUrl: "https://oura.example.test",
      authBaseUrl: "https://oura-auth.example.test",
      backfillDays: 21,
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      reconcileDays: 7,
      reconcileIntervalMs: 7_200_000,
      requestTimeoutMs: 30_000,
      scopes: ["daily", "heartrate"],
      webhookTimestampToleranceMs: 60_000,
    },
    whoop: {
      backfillDays: 30,
      baseUrl: "https://whoop.example.test",
      clientId: "whoop-client-id",
      clientSecret: "whoop-client-secret",
      reconcileDays: 14,
      reconcileIntervalMs: 10_800_000,
      requestTimeoutMs: 30_000,
      scopes: ["read:profile", "read:sleep"],
      webhookTimestampToleranceMs: 120_000,
    },
  });
});

test("parseSerializableConfiguredDeviceSyncProviderConfigs rejects unknown providers and runtime-only fields", () => {
  assert.throws(
    () =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          fitbit: {
            clientId: "fitbit-client-id",
            clientSecret: "fitbit-client-secret",
          },
        },
        "runtime.providerConfigs",
      ),
    /runtime\.providerConfigs\.fitbit is not a supported device-sync provider config/u,
  );

  assert.throws(
    () =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          oura: {
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
            fetchImpl: "not-serializable",
          },
        },
        "runtime.providerConfigs",
      ),
    /runtime\.providerConfigs\.oura\.fetchImpl is not supported in serialized runtime config/u,
  );

  assert.throws(
    () =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          whoop: {
            clientId: "whoop-client-id",
            clientSecret: "whoop-client-secret",
            scopes: ["read:profile", ""],
          },
        },
        "runtime.providerConfigs",
      ),
    /runtime\.providerConfigs\.whoop\.scopes\[1\] must be a non-empty string/u,
  );

  assert.throws(
    () =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          oura: {
            clientId: "oura-client-id",
            clientSecret: "oura-client-secret",
            webhookVerificationToken: "verify-token-for-tests",
          },
        },
        "runtime.providerConfigs",
      ),
    /runtime\.providerConfigs\.oura\.webhookVerificationToken is not supported in serialized runtime config/u,
  );
});

test("loadDeviceSyncEnvironment rejects incomplete provider credentials", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        OURA_CLIENT_ID: "oura-client-id",
        ...createDeviceSyncEnv(),
      }),
    /Oura configuration is incomplete/u,
  );
});

test("loadDeviceSyncEnvironment supports an explicit control token and public listener", () => {
  const loaded = loadDeviceSyncEnvironment({
    DEVICE_SYNC_PUBLIC_HOST: "0.0.0.0",
    DEVICE_SYNC_PUBLIC_PORT: "9876",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    ...createDeviceSyncEnv(),
  });

  assert.equal(loaded.http.controlToken, "control-token-for-tests");
  assert.equal(loaded.http.publicHost, "0.0.0.0");
  assert.equal(loaded.http.publicPort, 9876);
});

test("loadDeviceSyncEnvironment keeps provider-owned webhook secrets off the generic service and http shapes", () => {
  const loaded = loadDeviceSyncEnvironment({
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    OURA_WEBHOOK_VERIFICATION_TOKEN: "verify-token-for-tests",
    ...createDeviceSyncEnv(),
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(loaded.service.config, "webhookVerificationToken"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(loaded.http, "webhookVerificationToken"),
    false,
  );
});

test("loadDeviceSyncEnvironment rejects non-decimal and out-of-range listener ports", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_PORT: "1e3",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        ...createDeviceSyncEnv(),
      }),
    /DEVICE_SYNC_PORT must be an integer/u,
  );
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_PUBLIC_HOST: "0.0.0.0",
        DEVICE_SYNC_PUBLIC_PORT: "70000",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        ...createDeviceSyncEnv(),
      }),
    /DEVICE_SYNC_PUBLIC_PORT must be an integer between 0 and 65535/u,
  );
});

test("loadDeviceSyncEnvironment rejects non-loopback DEVICE_SYNC_HOST values", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_HOST: "0.0.0.0",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        ...createDeviceSyncEnv(),
      }),
    /DEVICE_SYNC_HOST must be a loopback hostname or address/u,
  );
});

test("loadDeviceSyncEnvironment rejects URL-bracket control listener hosts", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_HOST: "[::1]",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        ...createDeviceSyncEnv(),
      }),
    /DEVICE_SYNC_HOST must be a loopback hostname or address/u,
  );
});

test("loadDeviceSyncEnvironment ignores the removed bare PORT alias", () => {
  const loaded = loadDeviceSyncEnvironment({
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    PORT: "9999",
    ...createDeviceSyncEnv(),
  } as NodeJS.ProcessEnv);

  assert.equal(loaded.http.port, 8788);
});

test("loadDeviceSyncEnvironment rejects partial public listener configuration", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_PUBLIC_HOST: "0.0.0.0",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        ...createDeviceSyncEnv(),
      }),
    /DEVICE_SYNC_PUBLIC_HOST and DEVICE_SYNC_PUBLIC_PORT together/u,
  );
});

test("loadDeviceSyncEnvironment rejects URL-bracket public listener hosts", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        DEVICE_SYNC_PUBLIC_HOST: "[::1]",
        DEVICE_SYNC_PUBLIC_PORT: "9876",
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        ...createDeviceSyncEnv(),
      }),
    /DEVICE_SYNC_PUBLIC_HOST must be a hostname or address without URL bracket syntax/u,
  );
});

test("loadDeviceSyncEnvironment requires at least one provider", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        ...createDeviceSyncEnv(),
      }),
    /No device sync providers are configured/u,
  );
});

test("loadDeviceSyncEnvironment requires DEVICE_SYNC_CONTROL_TOKEN", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        ...createDeviceSyncEnv({
          DEVICE_SYNC_CONTROL_TOKEN: undefined,
        }),
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
      }),
    /DEVICE_SYNC_CONTROL_TOKEN/u,
  );
});

test("loadDeviceSyncEnvironment requires DEVICE_SYNC_VAULT_ROOT instead of the removed VAULT_ROOT alias", () => {
  assert.throws(
    () =>
      loadDeviceSyncEnvironment({
        VAULT_ROOT: "/tmp/murph-vault",
        ...createDeviceSyncEnv({
          DEVICE_SYNC_VAULT_ROOT: undefined,
        }),
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
      } as NodeJS.ProcessEnv),
    /DEVICE_SYNC_VAULT_ROOT/u,
  );
});

test("readConfiguredOuraDeviceSyncProviderConfig keeps the optional webhook verification token on the provider config", () => {
  const config = readConfiguredOuraDeviceSyncProviderConfig({
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    OURA_WEBHOOK_VERIFICATION_TOKEN: "verify-token-for-tests",
  });

  assert.equal(config?.webhookVerificationToken, "verify-token-for-tests");
});

test("readConfiguredOuraDeviceSyncProviderConfig trims scopes and parses integer overrides", () => {
  const config = readConfiguredOuraDeviceSyncProviderConfig({
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    OURA_SCOPES: " daily:read , heartrate:read,  ",
    OURA_BACKFILL_DAYS: "30",
    OURA_RECONCILE_DAYS: "7",
    OURA_RECONCILE_INTERVAL_MS: "60000",
    OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "120000",
    OURA_REQUEST_TIMEOUT_MS: "5000",
  });

  assert.deepEqual(config, {
    clientId: "oura-client-id",
    clientSecret: "oura-client-secret",
    authBaseUrl: undefined,
    apiBaseUrl: undefined,
    scopes: ["daily:read", "heartrate:read"],
    backfillDays: 30,
    reconcileDays: 7,
    reconcileIntervalMs: 60000,
    webhookTimestampToleranceMs: 120000,
    webhookVerificationToken: undefined,
    requestTimeoutMs: 5000,
  });
});

test("readConfiguredOuraDeviceSyncProviderConfig rejects invalid integer overrides", () => {
  assert.throws(
    () =>
      readConfiguredOuraDeviceSyncProviderConfig({
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        OURA_BACKFILL_DAYS: "soon",
      }),
    /OURA_BACKFILL_DAYS must be an integer/u,
  );
  assert.throws(
    () =>
      readConfiguredOuraDeviceSyncProviderConfig({
        OURA_CLIENT_ID: "oura-client-id",
        OURA_CLIENT_SECRET: "oura-client-secret",
        OURA_BACKFILL_DAYS: "7days",
      }),
    /OURA_BACKFILL_DAYS must be an integer/u,
  );
});

test("createConsoleDeviceSyncLogger forwards messages and defaults missing context to an empty object", () => {
  const writes: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(String(chunk));
      callback();
    },
  });
  const logger = createConsoleDeviceSyncLogger(new Console({ stdout: sink, stderr: sink }));
  const debug = requireValue(logger.debug);
  const info = requireValue(logger.info);
  const warn = requireValue(logger.warn);
  const error = requireValue(logger.error);

  debug("debug message");
  info("info message", { connected: true });
  warn("warn message");
  error("error message", { retryable: false });

  const output = writes.join("");
  assert.match(output, /debug message \{\}/u);
  assert.match(output, /info message \{ connected: true \}/u);
  assert.match(output, /warn message \{\}/u);
  assert.match(output, /error message \{ retryable: false \}/u);
});

test("loadDeviceSyncEnvironment wires Oura webhook timestamp tolerance into the provider", async () => {
  const loaded = loadDeviceSyncEnvironment({
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "1000",
    ...createDeviceSyncEnv(),
  });
  const providers = requireValue(loaded.service.providers);
  const provider = requireValue(providers.find((entry) => entry.provider === "oura"));
  const verifyAndParseWebhook = requireValue(provider.verifyAndParseWebhook);
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "delete",
      data_type: "session",
      object_id: "session-42",
      user_id: "oura-user-1",
      event_time: "2026-03-16T09:58:00.000Z",
    }),
    "utf8",
  );
  const timestamp = String(Math.floor(Date.parse("2026-03-16T09:59:58.000Z") / 1000));
  const signature = createHmac("sha256", "oura-client-secret")
    .update(`${timestamp}${rawBody.toString("utf8")}`)
    .digest("hex");

  await assert.rejects(
    verifyAndParseWebhook({
      headers: new Headers({
        "x-oura-signature": signature,
        "x-oura-timestamp": timestamp,
      }),
      rawBody,
      now: "2026-03-16T10:00:00.000Z",
    }),
    /allowed tolerance window/u,
  );
});
