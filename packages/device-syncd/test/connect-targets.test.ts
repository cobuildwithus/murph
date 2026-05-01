import assert from "node:assert/strict";
import { test } from "vitest";

import {
  listConfiguredDeviceSyncConnectTargets,
  readConfiguredDeviceSyncProviderConfigs,
  resolveConfiguredDeviceSyncConnectTarget,
} from "../src/config.ts";

test("connect targets prefer Junction for Oura and Strava but keep WHOOP direct-first", () => {
  const configs = readConfiguredDeviceSyncProviderConfigs({
    JUNCTION_API_KEY: "sk_us_junction-test",
    JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_PROVIDER_FILTER: "oura,strava,whoop,fitbit",
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
      connectTarget: target.connectTarget,
      provider: target.provider,
      sourceProviderSlug: target.sourceProviderSlug ?? null,
    })),
    [
      { connectTarget: "oura", provider: "junction", sourceProviderSlug: "oura" },
      { connectTarget: "whoop", provider: "whoop", sourceProviderSlug: null },
      { connectTarget: "strava", provider: "junction", sourceProviderSlug: "strava" },
      { connectTarget: "fitbit", provider: "junction", sourceProviderSlug: "fitbit" },
    ],
  );

  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Oura"), {
    connectTarget: "oura",
    label: "Oura",
    provider: "junction",
    sourceProviderSlug: "oura",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Strava"), {
    connectTarget: "strava",
    label: "Strava",
    provider: "junction",
    sourceProviderSlug: "strava",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "WHOOP"), {
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "whoop",
  });
});

test("connect targets apply the same Junction preference with the default Junction source list", () => {
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
    connectTarget: "oura",
    label: "Oura",
    provider: "junction",
    sourceProviderSlug: "oura",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "Strava"), {
    connectTarget: "strava",
    label: "Strava",
    provider: "junction",
    sourceProviderSlug: "strava",
  });
  assert.deepEqual(resolveConfiguredDeviceSyncConnectTarget(configs, "WHOOP"), {
    connectTarget: "whoop",
    label: "WHOOP",
    provider: "whoop",
  });
});
