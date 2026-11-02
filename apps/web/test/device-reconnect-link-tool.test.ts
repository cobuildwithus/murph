import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceConnectIntentTx: vi.fn(),
  tx: {},
}));

vi.mock("@/src/lib/device-sync/connect-intent-core", () => ({
  createHostedDeviceConnectIntentTx: mocks.createHostedDeviceConnectIntentTx,
  HOSTED_DEVICE_RECONNECT_NOTICE_INTENT_TTL_MS: 72 * 60 * 60 * 1000,
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
};

describe("hosted device reconnect link tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the WHOOP reconnect target from its Junction source slug", async () => {
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

  it.each([
    { connectSourceId: null, connectTarget: null, sourceProviderSlug: null },
    { connectSourceId: " ", connectTarget: "!!!", sourceProviderSlug: " " },
    { connectSourceId: "oura", connectTarget: "whoop", sourceProviderSlug: "whoop_v2" },
    { connectSourceId: "whoop", connectTarget: "oura", sourceProviderSlug: "whoop_v2" },
    { connectSourceId: "whoop", connectTarget: "whoop", sourceProviderSlug: "oura" },
    { connectSourceId: null, connectTarget: null, sourceProviderSlug: "unknown" },
  ])("rejects missing or mismatched reconnect selectors: %j", async (selectors) => {
    const { resolveHostedDeviceReconnectLinkTarget } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );
    expect(resolveHostedDeviceReconnectLinkTarget(configuredWhoopEnv, selectors))
      .toEqual({ status: "missing" });
  });

  it("matches all supplied normalized selectors against the same target", async () => {
    const { resolveHostedDeviceReconnectLinkTarget } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );
    expect(resolveHostedDeviceReconnectLinkTarget(configuredWhoopEnv, {
      connectSourceId: " WHOOP ",
      connectTarget: " WHOOP ",
      sourceProviderSlug: " WHOOP_V2 ",
    })).toMatchObject({ status: "found", target: {
      connectSourceId: "whoop", connectTarget: "whoop", sourceProviderSlug: "whoop_v2",
    } });
    expect(resolveHostedDeviceReconnectLinkTarget({}, {
      connectSourceId: "whoop", connectTarget: null, sourceProviderSlug: null,
    })).toEqual({ status: "missing" });
  });

  it("does not issue a hosted reconnect target for configured Strava routes", async () => {
    const { resolveHostedDeviceReconnectLinkTarget } = await import(
      "@/src/lib/device-sync/reconnect-link-tool"
    );

    expect(resolveHostedDeviceReconnectLinkTarget({
      ...configuredWhoopEnv,
      JUNCTION_PROVIDER_FILTER: "strava",
    }, {
      connectSourceId: "strava",
      connectTarget: null,
      sourceProviderSlug: null,
    })).toEqual({ status: "missing" });
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
