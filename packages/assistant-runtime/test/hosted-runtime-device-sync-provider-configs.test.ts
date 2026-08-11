import { describe, expect, it, vi } from "vitest";
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
});
