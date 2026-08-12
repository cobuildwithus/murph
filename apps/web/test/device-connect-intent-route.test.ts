import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  advanceMemberOwnedProviderSetup: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  claimHostedDeviceConnectIntentForStart: vi.fn(),
  readHostedDeviceConnectIntent: vi.fn(),
  releaseHostedDeviceConnectIntentStart: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  startHostedDeviceSyncConnection: vi.fn(),
  startMemberOwnedProviderSetupOAuth: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/connect-intents", () => ({
  claimHostedDeviceConnectIntentForStart: mocks.claimHostedDeviceConnectIntentForStart,
  readHostedDeviceConnectIntent: mocks.readHostedDeviceConnectIntent,
  releaseHostedDeviceConnectIntentStart: mocks.releaseHostedDeviceConnectIntentStart,
}));

vi.mock("@/src/lib/device-sync/hosted-connect-start", () => ({
  startHostedDeviceSyncConnection: mocks.startHostedDeviceSyncConnection,
}));

vi.mock("@/src/lib/device-sync/provider-setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/device-sync/provider-setup")>()),
  createMemberOwnedProviderSetupService: () => ({
    advance: mocks.advanceMemberOwnedProviderSetup,
    startOAuth: mocks.startMemberOwnedProviderSetupOAuth,
  }),
}));

vi.mock("@/src/lib/legal/consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/legal/consent")>()),
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
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
      callbackProofCookie: "murph-device-sync-whoop=proof; Path=/; HttpOnly",
    });
    mocks.advanceMemberOwnedProviderSetup.mockResolvedValue({
      setup: {
        action: "continue_sign_in",
        applicationRevision: null,
        connected: false,
        message: "Continue the secure provider sign-in.",
        provider: "strava",
        status: "waiting_for_user",
        updatedAt: "2026-08-11T12:00:00.000Z",
      },
      handoffUrl: "https://join.example.test/computer/handoff/synthetic-handoff",
    });
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects available direct claim links to the connect page intent flow", async () => {
    const response = await deviceConnectIntentRoute.GET(
      new Request("https://join.example.test/device/connect/dc_opaque"),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/connect#deviceConnectIntent=dc_opaque&connectSource=whoop",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.readHostedDeviceConnectIntent).toHaveBeenCalledWith("dc_opaque");
    expect(mocks.claimHostedDeviceConnectIntentForStart).not.toHaveBeenCalled();
  });

  it("keeps an exact member-owned claim read-only until the app page continues it", async () => {
    mocks.readHostedDeviceConnectIntent.mockResolvedValueOnce({
      status: "available",
      intent: createIntentRecord({
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        providerSetupId: "dps_synthetic",
      }),
    });

    const response = await deviceConnectIntentRoute.GET(
      new Request("https://join.example.test/device/connect/dc_opaque"),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/connect#deviceConnectIntent=dc_opaque&connectSource=strava",
    );
    expect(mocks.readHostedDeviceConnectIntent).toHaveBeenCalledWith("dc_opaque");
    expect(mocks.claimHostedDeviceConnectIntentForStart).not.toHaveBeenCalled();
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
    expect(mocks.advanceMemberOwnedProviderSetup).not.toHaveBeenCalled();
    expect(mocks.startMemberOwnedProviderSetupOAuth).not.toHaveBeenCalled();
    expect(mocks.startHostedDeviceSyncConnection).not.toHaveBeenCalled();
  });

  it("returns unavailable claim responses without redirecting", async () => {
    mocks.readHostedDeviceConnectIntent.mockResolvedValueOnce({
      status: "expired",
    });

    const response = await deviceConnectIntentRoute.GET(
      new Request("https://join.example.test/device/connect/dc_opaque"),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("This connection link has expired.");
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
    expect(response.headers.get("set-cookie")).toContain("murph-device-sync-whoop=proof");
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

  it("rejects existing Strava intents while direct and Junction provider support remain configured", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "");
    vi.stubEnv("STRAVA_CLIENT_ID", "strava-client");
    vi.stubEnv("STRAVA_CLIENT_SECRET", "strava-secret");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "strava");
    vi.stubEnv("JUNCTION_REGION", "us");
    mocks.claimHostedDeviceConnectIntentForStart.mockResolvedValueOnce({
      status: "claimed",
      intent: createIntentRecord({
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "junction",
        sourceProviderSlug: "strava",
        startedAt: new Date("2026-05-08T12:01:00.000Z"),
      }),
    });

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("This device connection is not available right now.");
    expect(mocks.releaseHostedDeviceConnectIntentStart).toHaveBeenCalledWith({
      claim: "dc_opaque",
      memberId: "member_123",
    });
    expect(mocks.startHostedDeviceSyncConnection).not.toHaveBeenCalled();
  });

  it("starts an exact member-owned Strava setup handoff", async () => {
    mocks.claimHostedDeviceConnectIntentForStart.mockResolvedValueOnce({
      status: "claimed",
      intent: createIntentRecord({
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        providerSetupId: "dps_synthetic",
        startedAt: new Date("2026-05-08T12:01:00.000Z"),
      }),
    });

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://join.example.test/computer/handoff/synthetic-handoff",
    );
    expect(mocks.advanceMemberOwnedProviderSetup).toHaveBeenCalledWith(
      "member_123",
      "dps_synthetic",
    );
    expect(mocks.releaseHostedDeviceConnectIntentStart).toHaveBeenCalledWith({
      claim: "dc_opaque",
      memberId: "member_123",
    });
    expect(mocks.startHostedDeviceSyncConnection).not.toHaveBeenCalled();
  });

  it("rejects a provider setup handoff outside Murph's first-party computer surface", async () => {
    mocks.claimHostedDeviceConnectIntentForStart.mockResolvedValueOnce({
      status: "claimed",
      intent: createIntentRecord({
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        providerSetupId: "dps_synthetic",
        startedAt: new Date("2026-05-08T12:01:00.000Z"),
      }),
    });
    mocks.advanceMemberOwnedProviderSetup.mockResolvedValueOnce({
      setup: {
        action: "continue_sign_in",
        applicationRevision: null,
        connected: false,
        message: "Continue the secure provider sign-in.",
        provider: "strava",
        status: "waiting_for_user",
        updatedAt: "2026-08-11T12:00:00.000Z",
      },
      handoffUrl: "https://attacker.example/computer/handoff/synthetic-handoff",
    });

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain(
      "Murph could not open the secure provider sign-in handoff.",
    );
    expect(mocks.releaseHostedDeviceConnectIntentStart).toHaveBeenCalledWith({
      claim: "dc_opaque",
      memberId: "member_123",
    });
  });

  it("returns JSON for app-page intent starts", async () => {
    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        headers: {
          accept: "application/json",
        },
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("murph-device-sync-whoop=proof");
  });

  it("maps JSON app-page start failures through the hosted browser mutation guard", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "CSRF_ORIGIN_REQUIRED",
        httpStatus: 403,
        message: "Hosted browser mutation routes require an Origin header.",
      });
    });

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        headers: {
          accept: "application/json",
        },
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CSRF_ORIGIN_REQUIRED",
        details: undefined,
        message: "Hosted browser mutation routes require an Origin header.",
        retryable: false,
      },
    });
    expect(mocks.claimHostedDeviceConnectIntentForStart).not.toHaveBeenCalled();
  });

  it("does not start provider OAuth when the claim belongs to another member", async () => {
    mocks.claimHostedDeviceConnectIntentForStart.mockResolvedValueOnce({
      status: "owner_mismatch",
    });

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        headers: {
          accept: "application/json",
        },
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_DEVICE_CONNECT_INTENT_OWNER_MISMATCH",
        message: "This connection link belongs to a different Murph account.",
        retryable: false,
      },
    });
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

  it("returns the WHOOP capacity error to the connect page and releases the claim", async () => {
    mocks.startHostedDeviceSyncConnection.mockRejectedValueOnce(deviceSyncError({
      code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
      httpStatus: 409,
      message:
        "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
      retryable: false,
    }));

    const response = await deviceConnectIntentRoute.POST(
      new Request("https://join.example.test/device/connect/dc_opaque", {
        headers: {
          accept: "application/json",
        },
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WHOOP_DIRECT_CONNECT_CAP_REACHED",
        message:
          "Direct WHOOP connections are full right now. You can keep WHOOP syncing through Apple Health in the Murph app.",
        retryable: false,
      },
    });
    expect(mocks.releaseHostedDeviceConnectIntentStart).toHaveBeenCalledWith({
      claim: "dc_opaque",
      memberId: "member_123",
    });
  });
});

function createIntentRecord(
  overrides: Partial<{
    connectSourceId: string;
    connectTarget: string;
    provider: "junction" | "strava" | "whoop";
    providerSetupId: string | null;
    sourceProviderSlug: string | null;
    startedAt: Date | null;
  }> = {},
) {
  return {
    claimHash: "claim_hash",
    connectSourceId: overrides.connectSourceId ?? "whoop",
    connectTarget: overrides.connectTarget ?? "whoop",
    createdAt: new Date("2026-05-08T12:00:00.000Z"),
    expiresAt: new Date("2026-05-08T12:15:00.000Z"),
    memberId: "member_123",
    provider: overrides.provider ?? "whoop",
    providerSetupId: overrides.providerSetupId ?? null,
    sourceProviderSlug: overrides.sourceProviderSlug ?? null,
    startedAt: overrides.startedAt ?? null,
  };
}
