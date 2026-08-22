import assert from "node:assert/strict";
import { Console } from "node:console";
import { createHmac } from "node:crypto";
import { Writable } from "node:stream";
import { test } from "vitest";

import {
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
} from "@murphai/importers/device-providers/junction-resources";

import {
  cloneConfiguredDeviceSyncRuntimeConfig,
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  configuredDeviceSyncProviderKeys,
  createConsoleDeviceSyncLogger,
  createConfiguredDeviceSyncRegistry,
  deviceSyncProviderRuntimeSecretEnvKeys,
  deviceSyncProviderRuntimeVariableEnvKeys,
  hasConfiguredDeviceSyncProviderConfigs,
  listConfiguredDeviceSyncConnectTargets,
  listConfiguredDeviceSyncProviderNames,
  listJunctionLinkDeviceConnectRouteEntries,
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
  loadDeviceSyncEnvironment,
  resolveConfiguredDeviceSyncConnectTarget,
  parseConfiguredDeviceSyncRuntimeConfig,
  parseSerializableConfiguredDeviceSyncProviderConfigs,
  readConfiguredDeviceSyncRuntimeConfig,
  readConfiguredDeviceSyncProviderConfigs,
  readConfiguredOuraDeviceSyncProviderConfig,
  readConfiguredStravaDeviceSyncProviderConfig,
  readConfiguredWhoopDeviceSyncProviderConfig,
} from "../src/config.ts";
import {
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  normalizeJunctionProviderFilter,
} from "../src/config/junction-connect-sources.ts";
import { normalizeJunctionDeviceSyncRuntimeConfig } from "../src/config/provider-manifests.ts";
import { computeRetryDelayMs } from "../src/shared.ts";
import { createDeviceSyncEnv, requireValue } from "./helpers.ts";

const JUNCTION_LINK_TOKEN_FILTER_PROVIDER_SLUGS = new Set([
  "abbott_libreview",
  "accuchek_ble",
  "apple_health_kit",
  "beurer_api",
  "beurer_ble",
  "contour_ble",
  "cronometer",
  "dexcom",
  "dexcom_v3",
  "eight_sleep",
  "fitbit",
  "freestyle_libre",
  "freestyle_libre_ble",
  "garmin",
  "google_fit",
  "google_health",
  "hammerhead",
  "health_connect",
  "ihealth",
  "kardia",
  "manual",
  "map_my_fitness",
  "my_fitness_pal",
  "my_fitness_pal_v2",
  "omron",
  "omron_ble",
  "onetouch_ble",
  "oura",
  "peloton",
  "polar",
  "renpho",
  "runkeeper",
  "samsung_health",
  "strava",
  "tandem_source",
  "ultrahuman",
  "wahoo",
  "whoop",
  "whoop_v2",
  "withings",
  "zwift",
]);

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

test("loadDeviceSyncEnvironment supports Strava-only deployments", () => {
  const loaded = loadDeviceSyncEnvironment({
    STRAVA_CLIENT_ID: "strava-client-id",
    STRAVA_CLIENT_SECRET: "strava-client-secret",
    ...createDeviceSyncEnv(),
  });
  const providers = requireValue(loaded.service.providers);

  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.provider, "strava");
});

test("createConfiguredDeviceSyncRegistry assembles the configured providers in descriptor order", () => {
  const registry = createConfiguredDeviceSyncRegistry({
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.deepEqual(
    registry.list().map((provider) => provider.provider),
    ["oura", "whoop"],
  );
});

test("configuredDeviceSyncProviderKeys follow the shared descriptor order", () => {
  assert.deepEqual(configuredDeviceSyncProviderKeys, ["junction", "oura", "whoop", "strava"]);
});

test("legacy Garmin env does not configure a direct provider", () => {
  const env = {
    GARMIN_API_BASE_URL: "https://apis.garmin.com/wellness-api/rest",
    GARMIN_CLIENT_ID: "garmin-client-id",
    GARMIN_CLIENT_SECRET: "garmin-client-secret",
    ...createDeviceSyncEnv(),
  };

  assert.deepEqual(readConfiguredDeviceSyncProviderConfigs(env), {});
  assert.throws(
    () => loadDeviceSyncEnvironment(env),
    /No device sync providers are configured/u,
  );
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

test("connect targets expose direct providers plus Junction-backed sources", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "fitbit,map_my_fitness,garmin,dexcom_v3",
    JUNCTION_REGION: "us",
  });

  assert.deepEqual(
    listConfiguredDeviceSyncConnectTargets(configs).map((target) => ({
      connectSourceId: target.connectSourceId,
      connectTarget: target.connectTarget,
      provider: target.provider,
      sourceProviderSlug: target.sourceProviderSlug ?? null,
    })),
    [
      {
        connectSourceId: "fitbit",
        connectTarget: "fitbit",
        provider: "junction",
        sourceProviderSlug: "google_health",
      },
      {
        connectSourceId: "mapmyfitness",
        connectTarget: "map_my_fitness",
        provider: "junction",
        sourceProviderSlug: "map_my_fitness",
      },
      {
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        sourceProviderSlug: "garmin",
      },
      {
        connectSourceId: "dexcom",
        connectTarget: "dexcom_v3",
        provider: "junction",
        sourceProviderSlug: "dexcom_v3",
      },
    ],
  );
  assert.equal(
    resolveConfiguredDeviceSyncConnectTarget(configs, "Fitbit")?.provider,
    "junction",
  );
  assert.equal(resolveConfiguredDeviceSyncConnectTarget(configs, "dexcom_v3")?.connectSourceId, "dexcom");
  assert.equal(resolveConfiguredDeviceSyncConnectTarget(configs, "junction"), null);
});

test("Junction default connect targets cover the shared provider filter", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_REGION: "us",
  });

  assert.deepEqual(
    listConfiguredDeviceSyncConnectTargets(configs).map((target) =>
      target.sourceProviderSlug ?? target.connectTarget
    ),
    JUNCTION_DEFAULT_PROVIDER_FILTER,
  );
});

test("Junction default provider filter excludes non-Link connect routes", () => {
  for (const providerSlug of [
    "freestyle_libre_ble",
    "accuchek_ble",
    "contour_ble",
    "onetouch_ble",
    "apple_health_kit",
    "health_connect",
    "samsung_health",
  ]) {
    assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes(providerSlug), false);
  }

  assert.throws(
    () => normalizeJunctionProviderFilter(["accuchek_ble", "fitbit", "health_connect"]),
    /unsupported Junction Link provider slugs: accuchek_ble, health_connect/u,
  );

  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "fitbit",
    JUNCTION_REGION: "us",
  });

  assert.deepEqual(
    listConfiguredDeviceSyncConnectTargets(configs).map((target) => ({
      connectSourceId: target.connectSourceId,
      sourceProviderSlug: target.sourceProviderSlug,
    })),
    [{ connectSourceId: "fitbit", sourceProviderSlug: "google_health" }],
  );

  const sdkOnlyConfigs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "accuchek_ble",
    JUNCTION_REGION: "us",
  });
  assert.throws(
    () => listConfiguredDeviceSyncConnectTargets(sdkOnlyConfigs),
    /unsupported Junction Link provider slugs: accuchek_ble/u,
  );
});

test("Junction Link route slugs stay on the external Link token provider enum", () => {
  const linkRoutes = listJunctionLinkDeviceConnectRouteEntries();
  const linkRouteSlugs = linkRoutes.map(({ route }) => route.sourceProviderSlug);
  const unsupportedLinkRouteSlugs = linkRouteSlugs.filter((providerSlug) =>
    !JUNCTION_LINK_TOKEN_FILTER_PROVIDER_SLUGS.has(providerSlug)
  );

  assert.deepEqual(unsupportedLinkRouteSlugs, []);

  const whoopRoute = linkRoutes.find(({ source }) => source.connectSourceId === "whoop");
  const whoopJunctionLinkIdentity = whoopRoute
    ? {
        connectSourceId: whoopRoute.source.connectSourceId,
        connectTarget: whoopRoute.route.connectTarget,
        sourceProviderSlug: whoopRoute.route.sourceProviderSlug,
      }
    : null;

  assert.deepEqual(whoopJunctionLinkIdentity, {
    connectSourceId: "whoop",
    connectTarget: "whoop",
    sourceProviderSlug: "whoop_v2",
  });
  assert.equal(linkRouteSlugs.includes("whoop"), false);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("whoop_v2"), true);
  assert.equal(JUNCTION_DEFAULT_PROVIDER_FILTER.includes("whoop"), false);
  assert.throws(
    () => normalizeJunctionProviderFilter(["whoop"]),
    /unsupported Junction Link provider slugs: whoop/u,
  );
});

test("shared provider runtime env key lists stay aligned with the configured providers", () => {
  assert.deepEqual(deviceSyncProviderRuntimeSecretEnvKeys, [
    "JUNCTION_API_KEY",
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "JUNCTION_WEBHOOK_SECRET",
    "OURA_CLIENT_ID",
    "OURA_CLIENT_SECRET",
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
    "STRAVA_CLIENT_ID",
    "STRAVA_CLIENT_SECRET",
    "STRAVA_WEBHOOK_SIGNING_SECRET",
  ]);
  assert.deepEqual(deviceSyncProviderRuntimeVariableEnvKeys, [
    "JUNCTION_API_BASE_URL",
    "JUNCTION_CLIENT_USER_ID_NAMESPACE",
    "JUNCTION_ENV",
    "JUNCTION_PROVIDER_FILTER",
    "JUNCTION_PUSH_SOURCE_RECOVERY_ENABLED",
    "JUNCTION_RECONCILE_DAYS",
    "JUNCTION_RECONCILE_INTERVAL_MS",
    "JUNCTION_REGION",
    "JUNCTION_REQUEST_TIMEOUT_MS",
    "JUNCTION_SUMMARY_BACKFILL_DAYS",
    "JUNCTION_SUMMARY_RESOURCES",
    "JUNCTION_TIMESERIES_BACKFILL_DAYS",
    "JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS",
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
    "STRAVA_API_BASE_URL",
    "STRAVA_AUTH_BASE_URL",
    "STRAVA_BACKFILL_DAYS",
    "STRAVA_RECONCILE_DAYS",
    "STRAVA_RECONCILE_INTERVAL_MS",
    "STRAVA_REQUEST_TIMEOUT_MS",
    "STRAVA_SCOPES",
    "STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS",
  ]);
});

test("cloneSerializableConfiguredDeviceSyncProviderConfigs strips provider-only runtime fields", () => {
  const cloned = cloneSerializableConfiguredDeviceSyncProviderConfigs({
    oura: {
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      fetchImpl: fetch,
      scopes: ["daily", "spo2"],
      webhookVerificationToken: "verify-token-for-tests",
    },
    whoop: {
      clientId: "whoop-client-id",
      clientSecret: "whoop-client-secret",
      fetchImpl: fetch,
      scopes: ["read:profile"],
    },
    strava: {
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      fetchImpl: fetch,
      scopes: ["activity:read", "activity:read_all"],
      webhookSigningSecret: "signing-secret-for-tests",
      webhookTimestampToleranceMs: 300_000,
      webhookVerifyToken: "verify-token-for-tests",
    },
  });

  assert.deepEqual(cloned, {
    oura: {
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      scopes: ["daily", "spo2"],
    },
    whoop: {
      clientId: "whoop-client-id",
      clientSecret: "whoop-client-secret",
      scopes: ["read:profile"],
    },
    strava: {
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      scopes: ["activity:read", "activity:read_all"],
      webhookTimestampToleranceMs: 300_000,
    },
  });
});

test("readConfiguredDeviceSyncRuntimeConfig keeps only the shared hosted runtime subset", () => {
  const runtimeConfig = readConfiguredDeviceSyncRuntimeConfig({
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
    DEVICE_SYNC_SECRET: "runtime-codec-secret",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    OURA_WEBHOOK_VERIFICATION_TOKEN: "verify-token-for-tests",
  });

  assert.deepEqual(runtimeConfig, {
    providerConfigs: {
      oura: {
        clientId: "oura-client-id",
        clientSecret: "oura-client-secret",
      },
    },
    publicBaseUrl: "https://device-sync.example.test",
    secret: "runtime-codec-secret",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      requireValue(runtimeConfig)?.providerConfigs.oura ?? {},
      "webhookVerificationToken",
    ),
    false,
  );
});

test("Junction production timeseries activation stays code-owned outside hosted runtime config", () => {
  const env = {
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
    DEVICE_SYNC_SECRET: "runtime-codec-secret",
    JUNCTION_API_KEY: "sk_us_test_runtime",
    JUNCTION_CLIENT_USER_ID_SECRET: "<REDACTED_JUNCTION_CLIENT_USER_ID_SECRET>",
    JUNCTION_ENV: "sandbox",
    JUNCTION_REGION: "us",
    JUNCTION_TIMESERIES_RESOURCES: "steps,heartrate,weight",
  };
  const providerConfig = requireValue(readConfiguredDeviceSyncProviderConfigs(env).junction);

  assert.deepEqual(
    providerConfig.timeseriesResources,
    [...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES],
  );
  assert.deepEqual(
    normalizeJunctionDeviceSyncRuntimeConfig(providerConfig).timeseriesResources,
    [...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES],
  );

  const runtimeConfig = requireValue(readConfiguredDeviceSyncRuntimeConfig(env));
  assert.equal(
    Object.hasOwn(requireValue(runtimeConfig.providerConfigs.junction), "timeseriesResources"),
    false,
  );
});

test("parseConfiguredDeviceSyncRuntimeConfig accepts the shared hosted runtime shape", () => {
  const parsed = parseConfiguredDeviceSyncRuntimeConfig(
    {
      providerConfigs: {
        strava: {
          clientId: "strava-client-id",
          clientSecret: "strava-client-secret",
          scopes: ["activity:read"],
        },
      },
      publicBaseUrl: "https://device-sync.example.test",
      secret: "codec-secret",
    },
    "runtime.deviceSync",
  );

  assert.equal(parsed.publicBaseUrl, "https://device-sync.example.test");
  assert.equal(parsed.secret, "codec-secret");
  assert.deepEqual(parsed.providerConfigs.strava?.clientId, "strava-client-id");
  assert.deepEqual(parsed.providerConfigs.strava?.clientSecret, "strava-client-secret");
  assert.deepEqual(parsed.providerConfigs.strava?.scopes, ["activity:read"]);
});

test("parseConfiguredDeviceSyncRuntimeConfig rejects Junction timeseries resource overrides", () => {
  assert.throws(
    () =>
      parseConfiguredDeviceSyncRuntimeConfig(
        {
          providerConfigs: {
            junction: {
              environment: "sandbox",
              region: "us",
              timeseriesResources: ["blood_oxygen"],
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "codec-secret",
        },
        "runtime.deviceSync",
      ),
    /runtime\.deviceSync\.providerConfigs\.junction\.timeseriesResources is code-owned/u,
  );
});

test("parseConfiguredDeviceSyncRuntimeConfig rejects unknown top-level runtime fields", () => {
  assert.throws(
    () =>
      parseConfiguredDeviceSyncRuntimeConfig(
        {
          providerConfigs: {
            strava: {
              clientId: "strava-client-id",
              clientSecret: "strava-client-secret",
            },
          },
          publicBaseUrl: "https://device-sync.example.test",
          secret: "codec-secret",
          unexpectedField: "nope",
        },
        "runtime.deviceSync",
      ),
    /runtime\.deviceSync\.unexpectedField/u,
  );
});

test("readConfiguredDeviceSyncRuntimeConfig returns null when hosted runtime prerequisites are incomplete", () => {
  assert.equal(
    readConfiguredDeviceSyncRuntimeConfig({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      OURA_CLIENT_ID: "oura-client-id",
      OURA_CLIENT_SECRET: "oura-client-secret",
    }),
    null,
  );
  assert.deepEqual(
    readConfiguredDeviceSyncRuntimeConfig({
      DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
      DEVICE_SYNC_SECRET: "runtime-codec-secret",
    }),
    {
      providerConfigs: {},
      publicBaseUrl: "https://device-sync.example.test",
      secret: "runtime-codec-secret",
    },
  );
  assert.throws(
    () =>
      readConfiguredDeviceSyncRuntimeConfig({
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "runtime-codec-secret",
        OURA_CLIENT_ID: "oura-client-id",
      }),
    /Oura configuration is incomplete/u,
  );
});

test("cloneConfiguredDeviceSyncRuntimeConfig preserves the runtime-safe shape and clones arrays", () => {
  const runtimeConfig = {
    providerConfigs: {
      whoop: {
        clientId: "whoop-client-id",
        clientSecret: "whoop-client-secret",
        scopes: ["read:profile"],
      },
    },
    publicBaseUrl: "https://device-sync.example.test",
    secret: "runtime-codec-secret",
  };
  const cloned = cloneConfiguredDeviceSyncRuntimeConfig(runtimeConfig);

  assert.deepEqual(cloned, {
    providerConfigs: {
      whoop: {
        clientId: "whoop-client-id",
        clientSecret: "whoop-client-secret",
        scopes: ["read:profile"],
      },
    },
    publicBaseUrl: "https://device-sync.example.test",
    secret: "runtime-codec-secret",
  });
  assert.notEqual(cloned.providerConfigs.whoop?.scopes, runtimeConfig.providerConfigs.whoop?.scopes);
});

test("parseSerializableConfiguredDeviceSyncProviderConfigs parses the hosted runtime subset", () => {
  const parsed = parseSerializableConfiguredDeviceSyncProviderConfigs(
    {
      oura: {
        apiBaseUrl: "https://oura.example.test",
        authBaseUrl: "https://oura-auth.example.test",
        backfillDays: 21,
        clientId: "oura-client-id",
        clientSecret: "oura-client-secret",
        reconcileDays: 7,
        reconcileIntervalMs: 7_200_000,
        requestTimeoutMs: 30_000,
        scopes: ["daily", "spo2"],
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
      strava: {
        apiBaseUrl: "https://strava.example.test",
        authBaseUrl: "https://strava-auth.example.test",
        backfillDays: 30,
        clientId: "strava-client-id",
        clientSecret: "strava-client-secret",
        reconcileDays: 14,
        reconcileIntervalMs: 14_400_000,
        requestTimeoutMs: 30_000,
        scopes: ["activity:read"],
      },
    },
    "runtime.providerConfigs",
  );

  assert.deepEqual(parsed, {
    oura: {
      apiBaseUrl: "https://oura.example.test",
      authBaseUrl: "https://oura-auth.example.test",
      backfillDays: 21,
      clientId: "oura-client-id",
      clientSecret: "oura-client-secret",
      reconcileDays: 7,
      reconcileIntervalMs: 7_200_000,
      requestTimeoutMs: 30_000,
      scopes: ["daily", "spo2"],
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
    strava: {
      apiBaseUrl: "https://strava.example.test",
      authBaseUrl: "https://strava-auth.example.test",
      backfillDays: 30,
      clientId: "strava-client-id",
      clientSecret: "strava-client-secret",
      reconcileDays: 14,
      reconcileIntervalMs: 14_400_000,
      requestTimeoutMs: 30_000,
      scopes: ["activity:read"],
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
    /runtime\.providerConfigs\.oura\.webhookVerificationToken is a provider-owned admin secret/u,
  );

  assert.throws(
    () =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          strava: {
            clientId: "strava-client-id",
            clientSecret: "strava-client-secret",
            webhookSigningSecret: "signing-secret-for-tests",
          },
        },
        "runtime.providerConfigs",
      ),
    /runtime\.providerConfigs\.strava\.webhookSigningSecret is a provider-owned webhook signing secret/u,
  );

  assert.throws(
    () =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          strava: {
            clientId: "strava-client-id",
            clientSecret: "strava-client-secret",
            webhookVerifyToken: "verify-token-for-tests",
          },
        },
        "runtime.providerConfigs",
      ),
    /runtime\.providerConfigs\.strava\.webhookVerifyToken is a provider-owned admin secret/u,
  );

  assert.throws(
    () =>
      parseSerializableConfiguredDeviceSyncProviderConfigs(
        {
          strava: {
            clientId: "strava-client-id",
            clientSecret: "strava-client-secret",
            mysteriousField: "nope",
          },
        },
        "runtime.providerConfigs",
      ),
    /runtime\.providerConfigs\.strava\.mysteriousField is not a supported serialized provider config field/u,
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
    OURA_SCOPES: " daily:read , spo2:read,  ",
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
    scopes: ["daily:read", "spo2:read"],
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

test("readConfiguredWhoopDeviceSyncProviderConfig trims scopes and parses integer overrides", () => {
  const config = readConfiguredWhoopDeviceSyncProviderConfig({
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
    WHOOP_BASE_URL: "https://api.whoop.example.test",
    WHOOP_SCOPES: "read:profile, read:sleep, ",
    WHOOP_BACKFILL_DAYS: "21",
    WHOOP_RECONCILE_DAYS: "14",
    WHOOP_RECONCILE_INTERVAL_MS: "7200000",
    WHOOP_REQUEST_TIMEOUT_MS: "10000",
    WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "300000",
  });

  assert.deepEqual(config, {
    backfillDays: 21,
    baseUrl: "https://api.whoop.example.test",
    clientId: "whoop-client-id",
    clientSecret: "whoop-client-secret",
    reconcileDays: 14,
    reconcileIntervalMs: 7_200_000,
    requestTimeoutMs: 10_000,
    scopes: ["read:profile", "read:sleep"],
    webhookTimestampToleranceMs: 300_000,
  });
});

test("readConfiguredStravaDeviceSyncProviderConfig trims scopes and keeps provider-owned webhook secrets", () => {
  const config = readConfiguredStravaDeviceSyncProviderConfig({
    STRAVA_CLIENT_ID: "strava-client-id",
    STRAVA_CLIENT_SECRET: "strava-client-secret",
    STRAVA_SCOPES: "activity:read, activity:read_all",
    STRAVA_BACKFILL_DAYS: "21",
    STRAVA_RECONCILE_DAYS: "7",
    STRAVA_RECONCILE_INTERVAL_MS: "14400000",
    STRAVA_REQUEST_TIMEOUT_MS: "15000",
    STRAVA_WEBHOOK_SIGNING_SECRET: "signing-secret-for-tests",
    STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS: "300000",
    STRAVA_WEBHOOK_VERIFY_TOKEN: "verify-token-for-tests",
  });

  assert.deepEqual(config, {
    clientId: "strava-client-id",
    clientSecret: "strava-client-secret",
    authBaseUrl: undefined,
    apiBaseUrl: undefined,
    scopes: ["activity:read", "activity:read_all"],
    backfillDays: 21,
    reconcileDays: 7,
    reconcileIntervalMs: 14_400_000,
    requestTimeoutMs: 15_000,
    webhookSigningSecret: "signing-secret-for-tests",
    webhookTimestampToleranceMs: 300_000,
    webhookVerifyToken: "verify-token-for-tests",
  });
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
  const verifyAndParseWebhook = requireValue(provider.webhookHandler?.verifyAndParseWebhook);
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
