import { describe, expect, it } from "vitest";

import {
  createConfiguredDeviceSyncRegistry,
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
} from "@murphai/device-syncd/config";

import {
  createHostedDeviceSyncRegistry,
  mergeHostedDeviceSyncProviderConfigs,
} from "@/src/lib/device-sync/providers";

describe("createHostedDeviceSyncRegistry", () => {
  it("matches the shared configured-provider registry assembly path", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      WHOOP_CLIENT_ID: "whoop-client",
      WHOOP_CLIENT_SECRET: "whoop-secret",
      OURA_CLIENT_ID: "oura-client",
      OURA_CLIENT_SECRET: "oura-secret",
    };

    const hostedProviders = createHostedDeviceSyncRegistry(env).list().map((provider) => provider.provider);
    const sharedProviders = createConfiguredDeviceSyncRegistry(env).list().map((provider) => provider.provider);

    expect(hostedProviders).toEqual(sharedProviders);
    expect(hostedProviders).toEqual(["oura", "whoop"]);
  });
});


describe("mergeHostedDeviceSyncProviderConfigs", () => {
  it("preserves runtime defaults but strips operator-only fields for member-owned clients", () => {
    const fetchImpl = async () => new Response(null, { status: 204 });
    const merged = mergeHostedDeviceSyncProviderConfigs({
      base: {
        strava: {
          apiBaseUrl: "https://strava.test/api",
          authBaseUrl: "https://strava.test/oauth",
          clientId: "platform-client",
          clientSecret: "platform-secret",
          fetchImpl,
          reconcileDays: 7,
          scopes: ["read", "activity:read_all"],
          webhookSigningSecret: "platform-signing-secret",
          webhookVerifyToken: "platform-verify-token",
        },
      },
      overlay: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
        },
      },
    });

    expect(merged.strava).toEqual({
      apiBaseUrl: "https://strava.test/api",
      authBaseUrl: "https://strava.test/oauth",
      clientId: "member-client",
      clientSecret: "member-secret",
      reconcileDays: 7,
      scopes: ["read", "activity:read_all"],
    });
    expect(merged.strava).not.toHaveProperty("fetchImpl");
    expect(merged.strava).not.toHaveProperty("webhookSigningSecret");
    expect(merged.strava).not.toHaveProperty("webhookVerifyToken");
  });

  it("leaves unrelated configured providers untouched", () => {
    const whoop = {
      clientId: "whoop-client",
      clientSecret: "whoop-secret",
    };
    const merged = mergeHostedDeviceSyncProviderConfigs({
      base: { whoop },
      overlay: {
        strava: {
          clientId: "member-client",
          clientSecret: "member-secret",
        },
      },
    });

    expect(merged.whoop).toBe(whoop);
  });

  it("preserves Junction's code-owned production resources through member overlays", () => {
    const merged = mergeHostedDeviceSyncProviderConfigs({
      base: {
        junction: {
          apiKey: "platform-key",
          clientUserIdSecret: "platform-client-user-secret",
          environment: "sandbox",
          region: "us",
          timeseriesResources: [...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES],
        },
      },
      overlay: { junction: { environment: "sandbox", region: "us" } },
    });

    expect(merged.junction?.timeseriesResources)
      .toEqual([...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES]);
  });
});
