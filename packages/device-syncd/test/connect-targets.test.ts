import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isDeviceConnectSourceAvailableForConnection,
  listJunctionDeviceConnectRouteEntries,
  listJunctionLinkDeviceConnectRouteEntries,
  listConfiguredDeviceSyncConnectTargets,
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
    listConfiguredDeviceSyncConnectTargets(configs).map((target) => ({
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

// Exact ordered catalog output captured before the connect/reconnect collapse.
const expectedDefaultTargets = [
  { connectSourceId: "whoop", connectTarget: "whoop", label: "WHOOP", provider: "junction", sourceProviderSlug: "whoop_v2" },
  { connectSourceId: "mapmyfitness", connectTarget: "map_my_fitness", label: "MapMyFitness", provider: "junction", sourceProviderSlug: "map_my_fitness" },
  { connectSourceId: "ultrahuman", connectTarget: "ultrahuman", label: "Ultrahuman", provider: "junction", sourceProviderSlug: "ultrahuman" },
  { connectSourceId: "dexcom-g6-and-older", connectTarget: "dexcom", label: "Dexcom (G6 and older)", provider: "junction", sourceProviderSlug: "dexcom" },
  { connectSourceId: "renpho", connectTarget: "renpho", label: "Renpho", provider: "junction", sourceProviderSlug: "renpho" },
  { connectSourceId: "runkeeper", connectTarget: "runkeeper", label: "Runkeeper", provider: "junction", sourceProviderSlug: "runkeeper" },
  { connectSourceId: "tandem-source", connectTarget: "tandem_source", label: "Tandem Source", provider: "junction", sourceProviderSlug: "tandem_source" },
  { connectSourceId: "beurer", connectTarget: "beurer_api", label: "Beurer", provider: "junction", sourceProviderSlug: "beurer_api" },
  { connectSourceId: "strava", connectTarget: "strava", label: "Strava", provider: "junction", sourceProviderSlug: "strava" },
  { connectSourceId: "omron", connectTarget: "omron", label: "Omron", provider: "junction", sourceProviderSlug: "omron" },
  { connectSourceId: "eight-sleep", connectTarget: "eight_sleep", label: "Eight Sleep", provider: "junction", sourceProviderSlug: "eight_sleep" },
  { connectSourceId: "fitbit", connectTarget: "fitbit", label: "Fitbit", provider: "junction", sourceProviderSlug: "google_health" },
  { connectSourceId: "freestyle-libre", connectTarget: "freestyle_libre", label: "Freestyle Libre", provider: "junction", sourceProviderSlug: "freestyle_libre" },
  { connectSourceId: "garmin", connectTarget: "garmin", label: "Garmin", provider: "junction", sourceProviderSlug: "garmin" },
  { connectSourceId: "hammerhead", connectTarget: "hammerhead", label: "Hammerhead", provider: "junction", sourceProviderSlug: "hammerhead" },
  { connectSourceId: "ihealth", connectTarget: "ihealth", label: "iHealth", provider: "junction", sourceProviderSlug: "ihealth" },
  { connectSourceId: "oura", connectTarget: "oura", label: "Oura", provider: "junction", sourceProviderSlug: "oura" },
  { connectSourceId: "peloton", connectTarget: "peloton", label: "Peloton", provider: "junction", sourceProviderSlug: "peloton" },
  { connectSourceId: "wahoo", connectTarget: "wahoo", label: "Wahoo", provider: "junction", sourceProviderSlug: "wahoo" },
  { connectSourceId: "withings", connectTarget: "withings", label: "Withings", provider: "junction", sourceProviderSlug: "withings" },
  { connectSourceId: "google-fit", connectTarget: "google_fit", label: "Google Fit", provider: "junction", sourceProviderSlug: "google_fit" },
  { connectSourceId: "zwift", connectTarget: "zwift", label: "Zwift", provider: "junction", sourceProviderSlug: "zwift" },
  { connectSourceId: "abbott-libreview", connectTarget: "abbott_libreview", label: "Abbott LibreView", provider: "junction", sourceProviderSlug: "abbott_libreview" },
  { connectSourceId: "dexcom", connectTarget: "dexcom_v3", label: "Dexcom", provider: "junction", sourceProviderSlug: "dexcom_v3" },
  { connectSourceId: "kardia", connectTarget: "kardia", label: "Kardia", provider: "junction", sourceProviderSlug: "kardia" },
  { connectSourceId: "cronometer", connectTarget: "cronometer", label: "Cronometer", provider: "junction", sourceProviderSlug: "cronometer" },
  { connectSourceId: "polar", connectTarget: "polar", label: "Polar", provider: "junction", sourceProviderSlug: "polar" },
];

test("normalized targets preserve the full ordered catalog and empty configuration", () => {
  assert.deepEqual(listConfiguredDeviceSyncConnectTargets({}), []);
  assert.deepEqual(listConfiguredDeviceSyncConnectTargets({ junction: {} }), expectedDefaultTargets);
  assert.deepEqual(listConfiguredDeviceSyncConnectTargets({ junction: { providerFilter: [] } }), expectedDefaultTargets);
});

test("normalized targets are unique and retain first-occurrence order for every Link singleton and pair", () => {
  const slugs = listJunctionLinkDeviceConnectRouteEntries().map(({ route }) => route.sourceProviderSlug);
  const filters = [slugs, [...slugs].reverse(), [...slugs, ...slugs]];
  for (const first of slugs) {
    filters.push([first], [first, first], [` ${first.toUpperCase()} `]);
    for (const second of slugs) filters.push([first, second], [first, second, first, second]);
  }
  for (const providerFilter of filters) {
    const expectedSlugs = [...new Set(providerFilter.map(slug => {
      const normalized = slug.trim().toLowerCase();
      return normalized === "fitbit" ? "google_health" : normalized;
    }))];
    const expected = expectedSlugs.map(slug => {
      const target = expectedDefaultTargets.find(entry => entry.sourceProviderSlug === slug);
      assert.ok(target, `Missing expected target for ${slug}`);
      return target;
    });
    const targets = listConfiguredDeviceSyncConnectTargets({ junction: { providerFilter } });
    assert.deepEqual(targets, expected, JSON.stringify(providerFilter));
    for (const key of ["connectSourceId", "connectTarget", "sourceProviderSlug"] as const) {
      assert.equal(new Set(targets.map(target => target[key])).size, targets.length, key);
    }
  }
});

test("target enumeration rejects unsupported and SDK-only filters even beside a valid Link slug", () => {
  for (const providerFilter of [["unknown"], ["apple_health_kit"], ["whoop_v2", "unknown"]]) {
    assert.throws(
      () => listConfiguredDeviceSyncConnectTargets({ junction: { providerFilter } }),
      /unsupported Junction Link provider slugs/,
    );
  }
});
