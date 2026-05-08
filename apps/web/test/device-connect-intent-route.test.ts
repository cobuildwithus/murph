import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  claimHostedDeviceConnectIntentForStart: vi.fn(),
  getHostedAppSessionFromRequest: vi.fn(),
  readHostedDeviceConnectIntent: vi.fn(),
  releaseHostedDeviceConnectIntentStart: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  startHostedDeviceSyncConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/connect-intents", () => ({
  claimHostedDeviceConnectIntentForStart: mocks.claimHostedDeviceConnectIntentForStart,
  readHostedDeviceConnectIntent: mocks.readHostedDeviceConnectIntent,
  releaseHostedDeviceConnectIntentStart: mocks.releaseHostedDeviceConnectIntentStart,
}));

vi.mock("@/src/lib/device-sync/hosted-connect-start", () => ({
  startHostedDeviceSyncConnection: mocks.startHostedDeviceSyncConnection,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  getHostedAppSessionFromRequest: mocks.getHostedAppSessionFromRequest,
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

type DeviceConnectIntentRouteModule = typeof import("../app/device/connect/[claim]/route");

let deviceConnectIntentRoute: DeviceConnectIntentRouteModule;

describe("hosted device connect intent route", () => {
  beforeAll(async () => {
    deviceConnectIntentRoute = await import("../app/device/connect/[claim]/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WHOOP_CLIENT_ID", "whoop-client");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "whoop-secret");
    vi.stubEnv("JUNCTION_API_KEY", "");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "");
    vi.stubEnv("JUNCTION_ENV", "");
    vi.stubEnv("JUNCTION_REGION", "");
    vi.stubEnv("OURA_CLIENT_ID", "");
    vi.stubEnv("OURA_CLIENT_SECRET", "");
    vi.stubEnv("STRAVA_CLIENT_ID", "");
    vi.stubEnv("STRAVA_CLIENT_SECRET", "");
    mocks.getHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },
      sessionId: "hws_test",
    });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
      },
      sessionId: "hws_test",
    });
    mocks.readHostedDeviceConnectIntent.mockResolvedValue({
      status: "available",
      intent: createIntentRecord(),
    });
    mocks.claimHostedDeviceConnectIntentForStart.mockResolvedValue({
      status: "claimed",
      intent: createIntentRecord({
        startedAt: new Date("2026-05-08T12:01:00.000Z"),
      }),
    });
    mocks.startHostedDeviceSyncConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders confirmation only for the member that owns the claim", async () => {
    const response = await deviceConnectIntentRoute.GET(
      new Request("https://join.example.test/device/connect/dc_opaque"),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Connect WHOOP");
    expect(mocks.readHostedDeviceConnectIntent).toHaveBeenCalledWith("dc_opaque");
  });

  it("does not reveal confirmation to a different signed-in member", async () => {
    mocks.getHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        id: "member_other",
      },
      sessionId: "hws_other",
    });

    const response = await deviceConnectIntentRoute.GET(
      new Request("https://join.example.test/device/connect/dc_opaque"),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("different Murph account");
  });

  it("claims the intent for the active member before starting provider OAuth", async () => {
    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://provider.example.test/oauth/start");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.claimHostedDeviceConnectIntentForStart).toHaveBeenCalledWith({
      claim: "dc_opaque",
      memberId: "member_123",
    });
    expect(mocks.startHostedDeviceSyncConnection).toHaveBeenCalledWith({
      defaultReturnTo:
        "/device-sync/connect/complete?source=assistant&connectSource=whoop&connectTarget=whoop",
      request: expect.any(Request),
      target: expect.objectContaining({
        connectSourceId: "whoop",
        connectTarget: "whoop",
        provider: "whoop",
      }),
    });
  });

  it("does not start provider OAuth when the claim belongs to another member", async () => {
    mocks.claimHostedDeviceConnectIntentForStart.mockResolvedValueOnce({
      status: "owner_mismatch",
    });

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.startHostedDeviceSyncConnection).not.toHaveBeenCalled();
    expect(mocks.releaseHostedDeviceConnectIntentStart).not.toHaveBeenCalled();
  });

  it("releases the claim if provider OAuth start fails after claiming", async () => {
    mocks.startHostedDeviceSyncConnection.mockRejectedValueOnce(new Error("provider start failed"));

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(500);
    expect(mocks.releaseHostedDeviceConnectIntentStart).toHaveBeenCalledWith({
      claim: "dc_opaque",
      memberId: "member_123",
    });
  });
});

function createIntentRecord(
  overrides: Partial<{
    startedAt: Date | null;
  }> = {},
) {
  return {
    claimHash: "claim_hash",
    memberId: "member_123",
    provider: "whoop",
    connectSourceId: "whoop",
    connectTarget: "whoop",
    sourceProviderSlug: null,
    createdAt: new Date("2026-05-08T12:00:00.000Z"),
    expiresAt: new Date("2026-05-08T12:15:00.000Z"),
    startedAt: overrides.startedAt ?? null,
  };
}
