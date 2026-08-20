import { describe, expect, it, vi } from "vitest";
import { JUNCTION_PRODUCTION_TIMESERIES_RESOURCES } from "@murphai/device-syncd/config";
import { resolveHostedRuntimeDeviceSyncProviderConfigs } from "../src/hosted-runtime/device-sync-provider-configs.ts";

const staticProviderConfigs = {
  oura: {
    apiBaseUrl: "https://oura.example.test",
    clientId: "oura-client",
    clientSecret: "oura-secret",
  },
  strava: {
    apiBaseUrl: "https://platform-strava.example.test",
    clientId: "platform-strava-client",
    clientSecret: "platform-strava-secret",
    fetchImpl: vi.fn(),
    webhookSigningSecret: "platform-signing-secret",
    webhookVerifyToken: "platform-verify-token",
  },
};

describe("resolveHostedRuntimeDeviceSyncProviderConfigs", () => {
  it("overlays member credentials without retaining platform-only secrets or functions", () => {
    const resolved = resolveHostedRuntimeDeviceSyncProviderConfigs(
      staticProviderConfigs,
      {
        strava: {
          clientId: "member-strava-client",
          clientSecret: "member-strava-secret",
        },
      },
      {},
    );

    expect(resolved).toEqual({
      oura: staticProviderConfigs.oura,
      strava: {
        apiBaseUrl: "https://platform-strava.example.test",
        clientId: "member-strava-client",
        clientSecret: "member-strava-secret",
      },
    });
  });

  it("constructs a member-only provider when no platform provider is configured", () => {
    expect(
      resolveHostedRuntimeDeviceSyncProviderConfigs(
        {},
        {
          strava: {
            clientId: "member-strava-client",
            clientSecret: "member-strava-secret",
          },
        },
        {},
      ),
    ).toEqual({
      strava: {
        clientId: "member-strava-client",
        clientSecret: "member-strava-secret",
      },
    });
  });

  it("preserves all 48 code-owned Junction production resources through member overlays", () => {
    const resolved = resolveHostedRuntimeDeviceSyncProviderConfigs(
      {
        junction: {
          environment: "sandbox",
          region: "us",
        },
      },
      {
        junction: {
          environment: "sandbox",
          region: "us",
        },
      },
      {
        JUNCTION_API_KEY: "sk_us_test_runtime",
        JUNCTION_CLIENT_USER_ID_SECRET: "runtime-client-user-secret",
        JUNCTION_ENV: "sandbox",
        JUNCTION_PUSH_SOURCE_RECOVERY_ENABLED: "true",
        JUNCTION_REGION: "us",
      },
    );

    expect(resolved.junction).toMatchObject({
      environment: "sandbox",
      pushSourceRecoveryEnabled: true,
      region: "us",
    });
    expect(JUNCTION_PRODUCTION_TIMESERIES_RESOURCES).toHaveLength(48);
    expect(new Set(JUNCTION_PRODUCTION_TIMESERIES_RESOURCES).size).toBe(48);
    expect(resolved.junction?.timeseriesResources)
      .toEqual([...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES]);
  });
});
