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
  assert.throws(() => parseSerializableConfiguredDeviceSyncProviderConfigs({ whoop: {} }, "config"), /whoop/u);
});
