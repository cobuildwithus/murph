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
