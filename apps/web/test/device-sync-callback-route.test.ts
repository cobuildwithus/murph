import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildHostedDeviceSyncCallbackProof } from "@/src/lib/device-sync/browser-callback-proof";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const CALLBACK_STATE = "callback_state_1234567890";
const CALLBACK_URL =
  `https://control.example.test/api/device-sync/connect/junction/callback`
  + `?murph_state=${CALLBACK_STATE}&result=success`;

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  discardConnectionCallback: vi.fn(),
  handleConnectionCallback: vi.fn(),
  markMemberOwnedSetupConnected: vi.fn(),
  readMemberOwnedProviderSetupRegistration: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  deviceConnectionFindFirst: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/device-sync/provider-setup", () => ({
  createMemberOwnedProviderSetupService: () => ({
    markConnected: mocks.markMemberOwnedSetupConnected,
  }),
  readMemberOwnedProviderSetupRegistration: mocks.readMemberOwnedProviderSetupRegistration,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    deviceConnection: {
      findFirst: mocks.deviceConnectionFindFirst,
    },
  }),
}));

// The real error module stays unmocked so the route's isHostedOnboardingError
// check recognizes the instances the mocked session read rejects with.

type CallbackRouteModule =
  typeof import("../app/api/device-sync/connect/[provider]/callback/route");

let callbackRoute: CallbackRouteModule;

describe("hosted device-sync callback boundary", () => {
  beforeAll(async () => {
    callbackRoute = await import("../app/api/device-sync/connect/[provider]/callback/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      discardConnectionCallback: mocks.discardConnectionCallback,
      handleConnectionCallback: mocks.handleConnectionCallback,
    });
    mocks.discardConnectionCallback.mockResolvedValue(undefined);
    mocks.handleConnectionCallback.mockResolvedValue({
      account: {
        id: "dsc_junction",
        provider: "junction",
      },
      connectSourceId: "garmin",
      connectTarget: "garmin",
      returnTo:
        "https://control.example.test/device-sync/connect/complete"
        + "?source=connect&connectSource=garmin&connectTarget=garmin",
    });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_a" },
      sessionId: "session_a",
    });
    mocks.markMemberOwnedSetupConnected.mockResolvedValue(undefined);
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValue(null);
    mocks.deviceConnectionFindFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes the connection and redirects when the initiating browser returns", async () => {
    const request = buildCallbackRequest();

    const response = await callbackRoute.GET(
      request,
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    expect(mocks.handleConnectionCallback).toHaveBeenCalledWith("junction", {
      expectedOwnerId: "member_a",
    });
    expect(mocks.discardConnectionCallback).not.toHaveBeenCalled();
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/device-sync/connect/complete");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("connected");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("junction");
    // A newer concurrent start may own the provider proof slot by the time
    // this response applies, so no callback response may touch the cookie.
    expect(response.headers.get("set-cookie")).toBeNull();
  });


  it("projects a completed member-owned callback with the exact application binding", async () => {
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValue({
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
    });
    mocks.handleConnectionCallback.mockResolvedValueOnce({
      account: {
        id: "dsc_strava",
        provider: "strava",
      },
      connectSourceId: "strava",
      connectTarget: "strava",
      returnTo: "https://control.example.test/connect",
    });
    mocks.deviceConnectionFindFirst.mockResolvedValueOnce({
      providerApplicationId: "dpa_exact",
      providerApplicationRevision: 7,
    });

    const response = await callbackRoute.GET(
      buildProviderCallbackRequest("strava"),
      createRouteContext({ provider: "strava" }),
    );

    expect(response.status).toBe(302);
    expect(mocks.deviceConnectionFindFirst).toHaveBeenCalledWith({
      select: {
        providerApplicationId: true,
        providerApplicationRevision: true,
      },
      where: {
        id: "dsc_strava",
        provider: "strava",
        userId: "member_a",
      },
    });
    expect(mocks.markMemberOwnedSetupConnected).toHaveBeenCalledWith({
      applicationId: "dpa_exact",
      memberId: "member_a",
      revision: 7,
    });
  });

  it("does not turn a committed connection into a callback failure when projection repair fails", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.readMemberOwnedProviderSetupRegistration.mockReturnValue({
      coordinates: {
        connectSourceId: "strava",
        connectTarget: "strava",
        provider: "strava",
        sourceProviderSlug: null,
      },
    });
    mocks.handleConnectionCallback.mockResolvedValueOnce({
      account: {
        id: "dsc_strava",
        provider: "strava",
      },
      connectSourceId: "strava",
      connectTarget: "strava",
      returnTo: "https://control.example.test/connect",
    });
    mocks.deviceConnectionFindFirst.mockResolvedValueOnce({
      providerApplicationId: "dpa_exact",
      providerApplicationRevision: 7,
    });
    mocks.markMemberOwnedSetupConnected.mockRejectedValueOnce(
      new Error("NON_SECRET_TEST_PROJECTION_FAILURE"),
    );

    const response = await callbackRoute.GET(
      buildProviderCallbackRequest("strava"),
      createRouteContext({ provider: "strava" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("connected");
    expect(warningSpy).toHaveBeenCalledWith(
      "Member-owned provider setup callback projection failed.",
      { errorType: "Error", provider: "strava" },
    );
  });

  it("burns the callback state and shows the Connect error notice when the URL arrives without its proof", async () => {
    const request = new Request(CALLBACK_URL);

    const response = await callbackRoute.GET(
      request,
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/connect");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(destination.searchParams.get("deviceSyncError")).toBe("CALLBACK_PROOF_INVALID");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("junction");
    expect(mocks.discardConnectionCallback).toHaveBeenCalledWith("junction");
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
    // The single provider-wide proof slot may belong to a newer concurrent
    // flow, so an unmatched callback must not clear it.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects the initiating browser proof when the active member changes", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: { id: "member_b" },
      sessionId: "session_b",
    });

    const response = await callbackRoute.GET(
      buildCallbackRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/connect");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(mocks.discardConnectionCallback).toHaveBeenCalledWith("junction");
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("routes a signed-out callback to Connect recovery without touching state or proof", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "APP_SESSION_REQUIRED",
      httpStatus: 401,
      message: "An active app session is required.",
      retryable: false,
    }));

    const response = await callbackRoute.GET(
      buildCallbackRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/connect");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(destination.searchParams.get("deviceSyncError")).toBe("CALLBACK_SESSION_REQUIRED");
    expect(mocks.discardConnectionCallback).not.toHaveBeenCalled();
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves source intent on provider callback error redirects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValueOnce(deviceSyncError({
      code: "OAUTH_CALLBACK_REJECTED",
      details: {
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        returnTo: "https://control.example.test/connect",
      },
      httpStatus: 400,
      message: "OAuth authorization was denied or canceled.",
      retryable: false,
    }));

    const response = await callbackRoute.GET(
      buildCallbackRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("deviceSyncStatus=error");
    expect(location).toContain("deviceSyncError=OAUTH_CALLBACK_REJECTED");
    expect(location).toContain("connectSource=garmin");
    expect(location).toContain("connectTarget=garmin");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends replayed callbacks back without asserting a second outcome", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValueOnce(deviceSyncError({
      code: "OAUTH_STATE_REPLAYED",
      details: {
        provider: "junction",
        returnTo:
          "https://control.example.test/device-sync/connect/complete"
          + "?source=assistant&deviceSyncStatus=connected",
      },
      httpStatus: 409,
      message: "OAuth callback state was already handled by an earlier delivery.",
      retryable: false,
    }));

    const response = await callbackRoute.GET(
      buildCallbackRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.searchParams.get("source")).toBe("assistant");
    expect(destination.searchParams.get("deviceSyncStatus")).toBeNull();
    expect(destination.searchParams.get("deviceSyncError")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("routes unexpected completion failures to the Connect error notice", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValueOnce(new Error("boom"));

    const response = await callbackRoute.GET(
      buildCallbackRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/connect");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(destination.searchParams.get("deviceSyncError")).toBe("CALLBACK_FAILED");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("junction");
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync connection callback failed unexpectedly.",
      expect.objectContaining({
        errorType: "Error",
        provider: "junction",
      }),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("routes an undecodable provider callback to the Connect error notice", async () => {
    const response = await callbackRoute.GET(
      buildCallbackRequest(),
      createRouteContext({ provider: "%E0%A4%A" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/connect");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(destination.searchParams.get("deviceSyncError")).toBe("CALLBACK_FAILED");
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("falls back to a Connect completion redirect when the stored returnTo is missing", async () => {
    mocks.handleConnectionCallback.mockResolvedValueOnce({
      account: {
        id: "dsc_junction",
        provider: "junction",
      },
      connectSourceId: null,
      connectTarget: null,
      returnTo: null,
    });

    const response = await callbackRoute.GET(
      buildCallbackRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/connect");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("connected");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function buildProofCookie(): string {
  const { cookie } = buildHostedDeviceSyncCallbackProof({
    memberId: "member_a",
    provider: "junction",
    sessionId: "session_a",
    state: CALLBACK_STATE,
  });
  return cookie.split(";", 1)[0] ?? "";
}

function buildCallbackRequest(): Request {
  return new Request(CALLBACK_URL, {
    headers: {
      cookie: buildProofCookie(),
    },
  });
}

function buildProviderCallbackRequest(provider: string): Request {
  const callbackUrl = new URL(
    `/api/device-sync/connect/${encodeURIComponent(provider)}/callback`,
    "https://control.example.test",
  );
  callbackUrl.searchParams.set("murph_state", CALLBACK_STATE);
  callbackUrl.searchParams.set("result", "success");
  const { cookie } = buildHostedDeviceSyncCallbackProof({
    memberId: "member_a",
    provider,
    sessionId: "session_a",
    state: CALLBACK_STATE,
  });
  return new Request(callbackUrl, {
    headers: {
      cookie: cookie.split(";", 1)[0] ?? "",
    },
  });
}
