import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isDeviceConnectSourceAvailableForConnection,
  listJunctionDeviceConnectRouteEntries,
  listConfiguredDeviceSyncConnectTargets,
  listConfiguredDeviceSyncReconnectTargets,
  readConfiguredDeviceSyncProviderConfigs,
  resolveConfiguredDeviceSyncConnectTarget,
  resolveConfiguredDeviceSyncConnectTargetBySourceId,
} from "../src/config.ts";
import { readConfiguredDeviceSyncConnectTargetConfigs } from "../src/connect-config.ts";
import { HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT } from "../src/hosted-runtime.ts";

test("configured Junction source authority fits one runtime connection snapshot", () => {
  const sourceProviderSlugs = new Set(
    listJunctionDeviceConnectRouteEntries().map(
      ({ route }) => route.sourceProviderSlug,
    ),
  );

  assert.equal(sourceProviderSlugs.size, 33);
  assert.ok(
    sourceProviderSlugs.size
      <= HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
  );
});

test("connect targets prefer direct providers except Junction-backed WHOOP", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "oura,strava,whoop_v2,fitbit",
    JUNCTION_REGION: "us",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    STRAVA_CLIENT_ID: "strava-client-id",
    STRAVA_CLIENT_SECRET: "strava-client-secret",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
  });

  assert.deepEqual(
    listConfiguredDeviceSyncConnectTargets(configs).map((target) => ({
      connectSourceId: target.connectSourceId,
      connectTarget: target.connectTarget,
      provider: target.provider,
      sourceProviderSlug: target.sourceProviderSlug ?? null,
    })),
    [
      { connectSourceId: "oura", connectTarget: "oura", provider: "oura", sourceProviderSlug: null },
      { connectSourceId: "strava", connectTarget: "strava", provider: "strava", sourceProviderSlug: null },
      { connectSourceId: "whoop", connectTarget: "whoop", provider: "junction", sourceProviderSlug: "whoop_v2" },
      { connectSourceId: "fitbit", connectTarget: "fitbit", provider: "junction", sourceProviderSlug: "fitbit" },
    ],
  );

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Oura"), {
    connectSourceId: "oura",
    connectTarget: "oura",
    label: "Oura",
    provider: "oura",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Strava"), {
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "strava",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "WHOOP"), {
    connectSourceId: "whoop",
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "junction",
    sourceProviderSlug: "whoop_v2",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, "WHOOP"), {
    connectSourceId: "whoop",
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "junction",
    sourceProviderSlug: "whoop_v2",
  });
});

test("reconnect targets retain duplicate direct and Junction routes for exact recovery", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "whoop_v2",
    JUNCTION_REGION: "us",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
  });

  assert.deepEqual(
    listConfiguredDeviceSyncReconnectTargets(configs).map((target) => ({
      connectSourceId: target.connectSourceId,
      connectTarget: target.connectTarget,
      provider: target.provider,
      sourceProviderSlug: target.sourceProviderSlug ?? null,
    })),
    [
      { connectSourceId: "whoop", connectTarget: "whoop", provider: "whoop", sourceProviderSlug: null },
      { connectSourceId: "whoop", connectTarget: "whoop", provider: "junction", sourceProviderSlug: "whoop_v2" },
    ],
  );
});

test("Strava remains configured for status and self-hosted routing while its offer gate is disabled", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "strava",
    JUNCTION_REGION: "us",
    STRAVA_CLIENT_ID: "strava-client-id",
    STRAVA_CLIENT_SECRET: "strava-client-secret",
  });

  assert.ok(configs.strava);
  assert.equal(isDeviceConnectSourceAvailableForConnection("strava"), false);
  assert.deepEqual(listConfiguredDeviceSyncConnectTargets(configs), [{
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "strava",
  }]);
  assert.deepEqual(listConfiguredDeviceSyncReconnectTargets(configs), [
    {
      connectSourceId: "strava",
      connectTarget: "strava",
      label: "Strava",
      provider: "strava",
    },
    {
      connectSourceId: "strava",
      connectTarget: "strava",
      label: "Strava",
      provider: "junction",
      sourceProviderSlug: "strava",
    },
  ]);
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, "strava"), {
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "strava",
  });
});

test("WHOOP stays direct when the Junction provider filter excludes WHOOP", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "fitbit",
    JUNCTION_REGION: "us",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
  });

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "WHOOP"), {
    connectSourceId: "whoop",
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "whoop",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, "WHOOP"), {
    connectSourceId: "whoop",
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "whoop",
  });
});

test("lightweight connect target config reader matches provider config target presence", () => {
  const env = {
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "oura,strava,whoop_v2,fitbit",
    JUNCTION_REGION: "us",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    STRAVA_CLIENT_ID: "strava-client-id",
    STRAVA_CLIENT_SECRET: "strava-client-secret",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
  };

  assert.deepEqual(
    listConfiguredDeviceSyncConnectTargets(
      readConfiguredDeviceSyncConnectTargetConfigs(env),
    ),
    listConfiguredDeviceSyncConnectTargets(
      readConfiguredDeviceSyncProviderConfigs(env),
    ),
  );
});

test("connect target source-id lookups resolve direct and Junction sources", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "garmin",
    JUNCTION_REGION: "us",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
  });

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, "Oura"), {
    connectSourceId: "oura",
    connectTarget: "oura",
    label: "Oura",
    provider: "oura",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, "garmin"), {
    connectSourceId: "garmin",
    connectTarget: "garmin",
    label: "Garmin",
    provider: "junction",
    sourceProviderSlug: "garmin",
  });
});

test("connect targets keep Oura and WHOOP available with the default Junction source list", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_REGION: "us",
    OURA_CLIENT_ID: "oura-client-id",
    OURA_CLIENT_SECRET: "oura-client-secret",
    STRAVA_CLIENT_ID: "strava-client-id",
    STRAVA_CLIENT_SECRET: "strava-client-secret",
    WHOOP_CLIENT_ID: "whoop-client-id",
    WHOOP_CLIENT_SECRET: "whoop-client-secret",
  });

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Oura"), {
    connectSourceId: "oura",
    connectTarget: "oura",
    label: "Oura",
    provider: "oura",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Strava"), {
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "strava",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "WHOOP"), {
    connectSourceId: "whoop",
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "junction",
    sourceProviderSlug: "whoop_v2",
  });
});
