import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceConnectIntentTx: vi.fn(),
  ensureProviderSetup: vi.fn(),
  tx: {},
}));

vi.mock("@/src/lib/device-sync/connect-intent-core", () => ({
  createHostedDeviceConnectIntentTx: mocks.createHostedDeviceConnectIntentTx,
  HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS: 72 * 60 * 60 * 1000,
}));


vi.mock("@/src/lib/device-sync/provider-setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/device-sync/provider-setup")>()),
  createMemberOwnedProviderSetupService: () => ({
    ensure: mocks.ensureProviderSetup,
  }),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
  }),
}));

const configuredWhoopEnv = {
  HOSTED_WEB_BASE_URL: "https://join.example.test",
  JUNCTION_API_KEY: "sk_us_junction-test",
  JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
  JUNCTION_ENV: "sandbox",
  JUNCTION_PROVIDER_FILTER: "whoop_v2",
  JUNCTION_REGION: "us",
  WHOOP_CLIENT_ID: "whoop-client",
  WHOOP_CLIENT_SECRET: "whoop-secret",
};

describe("hosted device reconnect link tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Junction source slug to avoid choosing direct WHOOP", async () => {
    const { resolveHostedDeviceReconnectLinkTarget } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );

    expect(resolveHostedDeviceReconnectLinkTarget(configuredWhoopEnv, {
      connectSourceId: null,
      connectTarget: null,
      sourceProviderSlug: "whoop_v2",
    })).toEqual({
      status: "found",
      target: {
        connectSourceId: "whoop",
        connectTarget: "whoop",
        label: "WHOOP",
        provider: "junction",
        sourceProviderSlug: "whoop_v2",
      },
    });
  });

  it("refuses an ambiguous WHOOP target when direct and Junction routes are configured", async () => {
    const { resolveHostedDeviceReconnectLinkTarget } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );

    const result = resolveHostedDeviceReconnectLinkTarget(configuredWhoopEnv, {
      connectSourceId: null,
      connectTarget: "whoop",
      sourceProviderSlug: null,
    });

    expect(result.status).toBe("ambiguous");
    expect(result.status === "ambiguous" ? result.matches : []).toHaveLength(2);
  });

  it("ignores legacy direct Strava credentials in favor of the member-owned setup path", async () => {
    const { resolveHostedDeviceReconnectLinkTarget } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );

    expect(resolveHostedDeviceReconnectLinkTarget({
      HOSTED_WEB_BASE_URL: "https://join.example.test",
      STRAVA_CLIENT_ID: "NON_CREDENTIAL_LEGACY_CLIENT_ID",
      STRAVA_CLIENT_SECRET: "NON_CREDENTIAL_LEGACY_CLIENT_SECRET",
    }, {
      connectSourceId: null,
      connectTarget: "strava",
      sourceProviderSlug: null,
    })).toEqual({
      status: "found",
      target: {
        connectSourceId: "strava",
        connectTarget: "strava",
        label: "Strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
    });
  });

  it("resolves Strava to the member-owned setup path without global credentials", async () => {
    const { resolveHostedDeviceReconnectLinkTarget } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );

    expect(resolveHostedDeviceReconnectLinkTarget({
      HOSTED_WEB_BASE_URL: "https://join.example.test",
    }, {
      connectSourceId: "strava",
      connectTarget: null,
      sourceProviderSlug: null,
    })).toEqual({
      status: "found",
      target: {
        connectSourceId: "strava",
        connectTarget: "strava",
        label: "Strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
    });
  });

  it("creates a reconnect intent bound to the durable Strava setup", async () => {
    mocks.ensureProviderSetup.mockResolvedValueOnce({ id: "dps_synthetic" });
    mocks.createHostedDeviceConnectIntentTx.mockResolvedValueOnce({
      claim: "dc_strava",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_strava&connectSource=strava",
      deviceConnectUrl: "https://join.example.test/device/connect/dc_strava",
      expiresAt: "2026-06-19T12:00:00.000Z",
    });

    const { createHostedDeviceReconnectLink } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );
    await createHostedDeviceReconnectLink({
      args: {
        baseUrl: null,
        connectSourceId: "strava",
        connectTarget: null,
        help: false,
        memberId: "member_123",
        sourceProviderSlug: null,
      },
      env: { HOSTED_WEB_BASE_URL: "https://join.example.test" },
      now: new Date("2026-06-16T12:00:00.000Z"),
    });

    expect(mocks.ensureProviderSetup).toHaveBeenCalledWith("member_123");
    expect(mocks.createHostedDeviceConnectIntentTx).toHaveBeenCalledWith({
      connectSourceId: "strava",
      connectTarget: "strava",
      memberId: "member_123",
      now: new Date("2026-06-16T12:00:00.000Z"),
      provider: "strava",
      providerSetupId: "dps_synthetic",
      request: expect.any(Request),
      sourceProviderSlug: null,
      ttlMs: 72 * 60 * 60 * 1000,
      tx: mocks.tx,
    });
  });

  it("creates a long-lived source-specific connect intent for the selected target", async () => {
    mocks.createHostedDeviceConnectIntentTx.mockResolvedValueOnce({
      claim: "dc_opaque",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_opaque&connectSource=whoop",
      deviceConnectUrl: "https://join.example.test/device/connect/dc_opaque",
      expiresAt: "2026-06-19T12:00:00.000Z",
    });

    const { createHostedDeviceReconnectLink } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );
    const result = await createHostedDeviceReconnectLink({
      args: {
        baseUrl: null,
        connectSourceId: null,
        connectTarget: null,
        help: false,
        memberId: "member_123",
        sourceProviderSlug: "whoop_v2",
      },
      env: configuredWhoopEnv,
      now: new Date("2026-06-16T12:00:00.000Z"),
    });

    expect(mocks.createHostedDeviceConnectIntentTx).toHaveBeenCalledWith({
      connectSourceId: "whoop",
      connectTarget: "whoop",
      memberId: "member_123",
      now: new Date("2026-06-16T12:00:00.000Z"),
      provider: "junction",
      request: expect.any(Request),
      sourceProviderSlug: "whoop_v2",
      ttlMs: 72 * 60 * 60 * 1000,
      tx: mocks.tx,
    });
    expect(result).toMatchObject({
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_opaque&connectSource=whoop",
      target: {
        provider: "junction",
        sourceProviderSlug: "whoop_v2",
      },
    });
  });
});
