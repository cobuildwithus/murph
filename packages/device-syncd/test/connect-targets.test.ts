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
  const routeEntries = listJunctionDeviceConnectRouteEntries();
  const sourceProviderSlugs = new Set(
    routeEntries.map(({ route }) => route.sourceProviderSlug),
  );

  assert.equal(sourceProviderSlugs.size, routeEntries.length);
  assert.ok(
    sourceProviderSlugs.size
      <= HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT,
  );
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

test("Junction source labels remain connectable without direct OAuth providers", () => {
  const configs = { junction: { providerFilter: ["oura", "strava", "whoop_v2", "garmin"] } };
  for (const [source, slug] of [["oura", "oura"], ["strava", "strava"], ["whoop", "whoop_v2"], ["garmin", "garmin"]]) {
    const target = resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, source!);
    assert.equal(target?.provider, "junction");
    assert.equal(target?.sourceProviderSlug, slug);
  }
  assert.deepEqual(listConfiguredDeviceSyncReconnectTargets(configs), listConfiguredDeviceSyncConnectTargets(configs));
  assert.equal(isDeviceConnectSourceAvailableForConnection("strava"), false);
  assert.equal(isDeviceConnectSourceAvailableForConnection("garmin"), true);
  assert.equal(resolveConfiguredDeviceSyncConnectTarget({ junction: { providerFilter: ["garmin"] } }, "whoop"), null);
});

test("connect targets resolve provider-labelled data through Junction", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "oura,strava,whoop_v2,fitbit",
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
      { connectSourceId: "oura", connectTarget: "oura", provider: "junction", sourceProviderSlug: "oura" },
      { connectSourceId: "strava", connectTarget: "strava", provider: "junction", sourceProviderSlug: "strava" },
      { connectSourceId: "whoop", connectTarget: "whoop", provider: "junction", sourceProviderSlug: "whoop_v2" },
      { connectSourceId: "fitbit", connectTarget: "fitbit", provider: "junction", sourceProviderSlug: "google_health" },
    ],
  );

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Oura"), {
    connectSourceId: "oura",
    connectTarget: "oura",
    label: "Oura",
    provider: "junction",
    sourceProviderSlug: "oura",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Strava"), {
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "junction",
    sourceProviderSlug: "strava",
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

test("reconnect targets retain the exact Junction route for recovery", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "whoop_v2",
    JUNCTION_REGION: "us",
  });

  assert.deepEqual(
    listConfiguredDeviceSyncReconnectTargets(configs).map((target) => ({
      connectSourceId: target.connectSourceId,
      connectTarget: target.connectTarget,
      provider: target.provider,
      sourceProviderSlug: target.sourceProviderSlug ?? null,
    })),
    [
      { connectSourceId: "whoop", connectTarget: "whoop", provider: "junction", sourceProviderSlug: "whoop_v2" },
    ],
  );
});

test("disabled offers remain configured for status and ingestion while fresh starts stay gated", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "strava",
    JUNCTION_REGION: "us",
  });

  assert.ok(configs.junction);
  assert.equal(isDeviceConnectSourceAvailableForConnection("strava"), false);
  assert.equal(isDeviceConnectSourceAvailableForConnection("dexcom"), false);
  assert.equal(isDeviceConnectSourceAvailableForConnection("google-fit"), false);
  assert.equal(isDeviceConnectSourceAvailableForConnection("fitbit"), true);
  assert.equal(
    isDeviceConnectSourceAvailableForConnection("dexcom-g6-and-older"),
    true,
  );
  assert.deepEqual(listConfiguredDeviceSyncConnectTargets(configs), [{
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "junction",
    sourceProviderSlug: "strava",
  }]);
  assert.deepEqual(listConfiguredDeviceSyncReconnectTargets(configs), [{
    connectSourceId: "strava", connectTarget: "strava", label: "Strava",
    provider: "junction", sourceProviderSlug: "strava",
  }]);
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, "strava"), {
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "junction",
    sourceProviderSlug: "strava",
  });
});

test("connect target source-id lookups resolve Junction sources", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "oura,garmin",
    JUNCTION_REGION: "us",
  });

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTargetBySourceId(configs, "Oura"), {
    connectSourceId: "oura",
    connectTarget: "oura",
    label: "Oura",
    provider: "junction",
    sourceProviderSlug: "oura",
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
  });

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Oura"), {
    connectSourceId: "oura",
    connectTarget: "oura",
    label: "Oura",
    provider: "junction",
    sourceProviderSlug: "oura",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Strava"), {
    connectSourceId: "strava",
    connectTarget: "strava",
    label: "Strava",
    provider: "junction",
    sourceProviderSlug: "strava",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "WHOOP"), {
    connectSourceId: "whoop",
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "junction",
    sourceProviderSlug: "whoop_v2",
  });
});
