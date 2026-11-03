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
  resolveConfiguredDeviceSyncConnectTarget,
  parseConfiguredDeviceSyncRuntimeConfig,
  parseSerializableConfiguredDeviceSyncProviderConfigs,
  readConfiguredDeviceSyncRuntimeConfig,
  readConfiguredDeviceSyncProviderConfigs,
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

test("only Junction is configured and runtime serialization preserves its secret boundary", () => {
  const config = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_test",
    JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-junction-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_REGION: "us",
    OURA_CLIENT_ID: "retired", OURA_CLIENT_SECRET: "retired",
    WHOOP_CLIENT_ID: "retired", WHOOP_CLIENT_SECRET: "retired",
    STRAVA_CLIENT_ID: "retired", STRAVA_CLIENT_SECRET: "retired",
  });
  assert.deepEqual(configuredDeviceSyncProviderKeys, ["junction"]);
  assert.deepEqual(listConfiguredDeviceSyncProviderNames(config), ["junction"]);
  assert.deepEqual(createConfiguredDeviceSyncRegistry(config.junction ? {
    JUNCTION_API_KEY: config.junction.apiKey,
    JUNCTION_CLIENT_USER_ID_SECRET: config.junction.clientUserIdSecret,
    JUNCTION_ENV: config.junction.environment, JUNCTION_REGION: config.junction.region,
  } : {}).list().map((provider) => provider.provider), ["junction"]);
  const serialized = cloneSerializableConfiguredDeviceSyncProviderConfigs(config);
  assert.equal("apiKey" in (serialized.junction ?? {}), false);
  assert.equal("clientUserIdSecret" in (serialized.junction ?? {}), false);
  const runtime = { providerConfigs: serialized, publicBaseUrl: "https://sync.example.test", secret: "runtime-secret" };
  assert.deepEqual(parseConfiguredDeviceSyncRuntimeConfig(runtime, "runtime"), runtime);
  const cloned = cloneConfiguredDeviceSyncRuntimeConfig(runtime);
  assert.deepEqual(cloned, runtime);
  assert.notEqual(cloned.providerConfigs.junction, runtime.providerConfigs.junction);
});

test("runtime config from an older Web drops retired direct providers and still rejects unknown ones", () => {
  const junction = { environment: "sandbox", region: "us" };
  const olderWebRuntime = {
    providerConfigs: {
      junction,
      oura: { clientId: "retired", clientSecret: "retired", scopes: ["daily"] },
      strava: { clientId: "retired", clientSecret: "retired" },
      whoop: { clientId: "retired", clientSecret: "retired", backfillDays: 30 },
    },
    publicBaseUrl: "https://sync.example.test",
    secret: "runtime-secret",
  };
  const parsed = parseConfiguredDeviceSyncRuntimeConfig(olderWebRuntime, "runtime");
  assert.deepEqual(Object.keys(parsed.providerConfigs), ["junction"]);
  assert.deepEqual(
    parseSerializableConfiguredDeviceSyncProviderConfigs({ whoop: {} }, "config"),
    {},
  );
  assert.throws(
    () => parseSerializableConfiguredDeviceSyncProviderConfigs({ polar: {} }, "config"),
    /config\.polar is not a supported device-sync provider config/u,
  );
});

test("createConfiguredDeviceSyncRegistry assembles the configured providers in descriptor order", () => {
  const registry = createConfiguredDeviceSyncRegistry({
    JUNCTION_API_KEY: "sk_us_test_config", JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-secret",
    JUNCTION_ENV: "sandbox", JUNCTION_REGION: "us",
  });

  assert.deepEqual(
    registry.list().map((provider) => provider.provider),
    ["junction"],
  );
});

test("configuredDeviceSyncProviderKeys follow the shared descriptor order", () => {
  assert.deepEqual(configuredDeviceSyncProviderKeys, ["junction"]);
});

test("legacy Garmin env does not configure a direct provider", () => {
  const env = {
    GARMIN_API_BASE_URL: "https://apis.garmin.com/wellness-api/rest",
    GARMIN_CLIENT_ID: "garmin-client-id",
    GARMIN_CLIENT_SECRET: "garmin-client-secret",
    ...createDeviceSyncEnv(),
  };

  assert.deepEqual(readConfiguredDeviceSyncProviderConfigs(env), {});

});

test("shared provider-config helpers preserve descriptor order and report presence", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_test_config", JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-secret",
    JUNCTION_ENV: "sandbox", JUNCTION_REGION: "us",
  });

  assert.equal(hasConfiguredDeviceSyncProviderConfigs({}), false);
  assert.equal(hasConfiguredDeviceSyncProviderConfigs(configs), true);
  assert.deepEqual(listConfiguredDeviceSyncProviderNames(configs), ["junction"]);
});

test("shared provider runtime env key lists stay aligned with the configured providers", () => {
  assert.deepEqual(deviceSyncProviderRuntimeSecretEnvKeys, [
    "JUNCTION_API_KEY",
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "JUNCTION_WEBHOOK_SECRET",
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
  ]);
});

const junctionRuntimeConfig = {
  environment: "sandbox" as const,
  region: "us" as const,
  providerFilter: ["oura", "whoop_v2"],
};
const junctionRuntimeEnv = {
  JUNCTION_API_KEY: "sk_us_test_config",
  JUNCTION_CLIENT_USER_ID_SECRET: "synthetic-secret",
  JUNCTION_ENV: "sandbox",
  JUNCTION_REGION: "us",
  JUNCTION_PROVIDER_FILTER: "oura,whoop_v2",
};

test("cloneSerializableConfiguredDeviceSyncProviderConfigs strips provider-only runtime fields", () => {
  const cloned = cloneSerializableConfiguredDeviceSyncProviderConfigs({
    junction: { ...junctionRuntimeConfig, apiKey: "sk_us_synthetic", clientUserIdSecret: "synthetic-secret",
      fetchImpl: fetch, webhookSecret: "synthetic-webhook-secret", timeseriesResources: ["steps"] },
  });
  assert.deepEqual(cloned, { junction: junctionRuntimeConfig });
});

test("readConfiguredDeviceSyncRuntimeConfig keeps only the shared hosted runtime subset", () => {
  const runtimeConfig = readConfiguredDeviceSyncRuntimeConfig({
    ...junctionRuntimeEnv,
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
    DEVICE_SYNC_SECRET: "runtime-codec-secret",
    JUNCTION_WEBHOOK_SECRET: "synthetic-webhook-secret",
  });
  assert.deepEqual(runtimeConfig, {
    providerConfigs: { junction: junctionRuntimeConfig },
    publicBaseUrl: "https://device-sync.example.test",
    secret: "runtime-codec-secret",
  });
  assert.equal(Object.hasOwn(requireValue(runtimeConfig).providerConfigs.junction ?? {}, "webhookSecret"), false);
});

test("parseConfiguredDeviceSyncRuntimeConfig accepts the shared hosted runtime shape", () => {
  const parsed = parseConfiguredDeviceSyncRuntimeConfig({
    providerConfigs: { junction: junctionRuntimeConfig },
    publicBaseUrl: "https://device-sync.example.test", secret: "codec-secret",
  }, "runtime.deviceSync");
  assert.equal(parsed.publicBaseUrl, "https://device-sync.example.test");
  assert.equal(parsed.secret, "codec-secret");
  assert.deepEqual(parsed.providerConfigs.junction, junctionRuntimeConfig);
});

test("parseConfiguredDeviceSyncRuntimeConfig rejects unknown top-level runtime fields", () => {
  assert.throws(() => parseConfiguredDeviceSyncRuntimeConfig({
    providerConfigs: { junction: junctionRuntimeConfig },
    publicBaseUrl: "https://device-sync.example.test", secret: "codec-secret", unexpectedField: "nope",
  }, "runtime.deviceSync"), /runtime\.deviceSync\.unexpectedField/u);
});

test("readConfiguredDeviceSyncRuntimeConfig returns null when hosted runtime prerequisites are incomplete", () => {
  assert.equal(readConfiguredDeviceSyncRuntimeConfig({
    ...junctionRuntimeEnv, DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
  }), null);
  assert.deepEqual(readConfiguredDeviceSyncRuntimeConfig({
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test", DEVICE_SYNC_SECRET: "runtime-codec-secret",
  }), { providerConfigs: {}, publicBaseUrl: "https://device-sync.example.test", secret: "runtime-codec-secret" });
  assert.throws(() => readConfiguredDeviceSyncRuntimeConfig({
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test", DEVICE_SYNC_SECRET: "runtime-codec-secret",
    JUNCTION_API_KEY: "sk_us_synthetic",
  }), /Junction configuration is incomplete/u);
});

test("cloneConfiguredDeviceSyncRuntimeConfig preserves the runtime-safe shape and clones arrays", () => {
  const config = { providerConfigs: { junction: junctionRuntimeConfig },
    publicBaseUrl: "https://device-sync.example.test", secret: "runtime-codec-secret" };
  const cloned = cloneConfiguredDeviceSyncRuntimeConfig(config);
  assert.deepEqual(cloned, config);
  assert.notEqual(cloned.providerConfigs.junction?.providerFilter, config.providerConfigs.junction.providerFilter);
});

test("parseSerializableConfiguredDeviceSyncProviderConfigs parses the hosted runtime subset", () => {
  const input = { junction: { ...junctionRuntimeConfig, apiBaseUrl: "https://junction.example.test",
    allowedLinkHosts: ["junction.example.test"], clientUserIdNamespace: "test", summaryBackfillDays: 21,
    timeseriesBackfillDays: 14, reconcileDays: 7, reconcileIntervalMs: 7_200_000, requestTimeoutMs: 30_000,
    summaryResources: ["sleep", "activity"], webhookTimestampToleranceMs: 60_000,
    pushSourceRecoveryEnabled: true } };
  assert.deepEqual(parseSerializableConfiguredDeviceSyncProviderConfigs(input, "runtime.providerConfigs"), input);
});

test("parseSerializableConfiguredDeviceSyncProviderConfigs rejects unknown providers and runtime-only fields", () => {
  assert.throws(() => parseSerializableConfiguredDeviceSyncProviderConfigs({ fitbit: {} }, "runtime.providerConfigs"),
    /runtime\.providerConfigs\.fitbit is not a supported device-sync provider config/u);
  for (const [field, value, message] of [
    ["fetchImpl", "not-serializable", /junction\.fetchImpl is not supported in serialized runtime config/u],
    ["providerFilter", ["oura", ""], /junction\.providerFilter\[1\] must be a non-empty string/u],
    ["apiKey", "sk_us_synthetic", /provider-owned API secret/u],
    ["clientUserIdSecret", "synthetic-secret", /provider-owned HMAC secret/u],
    ["webhookSecret", "synthetic-secret", /provider-owned webhook secret/u],
    ["mysteriousField", "nope", /junction\.mysteriousField is not a supported serialized provider config field/u],
  ] as const) {
    assert.throws(() => parseSerializableConfiguredDeviceSyncProviderConfigs({
      junction: { ...junctionRuntimeConfig, [field]: value },
    }, "runtime.providerConfigs"), message);
  }
});
