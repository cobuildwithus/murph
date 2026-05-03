import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type InternalDeviceSyncConnectLinkRouteModule = typeof import(
  "../app/api/internal/device-sync/connect-targets/[connectTarget]/connect-link/route"
);

let internalDeviceSyncConnectLinkRoute: InternalDeviceSyncConnectLinkRouteModule;

describe("device sync internal connect-link route", () => {
  beforeAll(async () => {
    internalDeviceSyncConnectLinkRoute = await import(
      "../app/api/internal/device-sync/connect-targets/[connectTarget]/connect-link/route"
    );
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
    mocks.getPrisma.mockReturnValue({ hostedMemberRouting: {} });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.readHostedMemberRoutingState.mockResolvedValue(null);
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      startConnection: mocks.startConnection,
    });
    mocks.startConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      state: "opaque-state",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates a hosted device connect link for the verified Cloudflare callback principal", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "whoop",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "whoop",
      "/settings?tab=wearables",
      { sourceProviderSlug: null },
    );
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
    expect(infoSpy).toHaveBeenCalledWith(
      "Hosted internal device-sync connect-link diagnostic.",
      {
        expiresAtPresent: true,
        messagingReturnTarget: null,
        provider: "whoop",
        stage: "control_plane",
        status: "issued",
      },
    );
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("provider.example.test");
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("opaque-state");
  });

  it("resolves Junction-backed public connect targets at the web boundary", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret-value");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "fitbit,whoop");
    vi.stubEnv("JUNCTION_REGION", "us");
    mocks.startConnection.mockResolvedValueOnce({
      authorizationUrl: "https://link.junction.example.test/session/link-token",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "junction",
      state: "opaque-state",
    });

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/fitbit/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "fitbit",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "junction",
      "/settings?tab=wearables",
      { sourceProviderSlug: "fitbit" },
    );
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://link.junction.example.test/session/link-token",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "fitbit",
      providerLabel: "Fitbit",
    });
  });

  it.each([
    {
      expectedReturnTo: "/api/device-sync/messaging-return?target=imessage&recipient=%2B15550100001",
      messagingReturnTarget: "imessage",
    },
    {
      expectedReturnTo: "/api/device-sync/messaging-return?target=telegram",
      messagingReturnTarget: "telegram",
    },
  ] as const)(
    "uses the $messagingReturnTarget messaging return route when requested by the signed callback",
    async ({ expectedReturnTo, messagingReturnTarget }) => {
      mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
        linqRecipientPhone: "+15550100001",
      });

      const response = await internalDeviceSyncConnectLinkRoute.POST(
        new Request("https://join.example.test/api/internal/device-sync/connect-targets/whoop/connect-link", {
          body: JSON.stringify({ messagingReturnTarget }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        }),
        {
          params: Promise.resolve({
            connectTarget: "whoop",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(mocks.startConnection).toHaveBeenCalledWith(
        "member_123",
        "whoop",
        expectedReturnTo,
        { sourceProviderSlug: null },
      );
      if (messagingReturnTarget === "imessage") {
        expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
          memberId: "member_123",
          prisma: { hostedMemberRouting: {} },
        });
      } else {
        expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
      }
    },
  );

  it("rejects unsupported messaging return targets without starting a connection", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/whoop/connect-link", {
        body: JSON.stringify({ messagingReturnTarget: "sms://open" }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "whoop",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET",
        message: "Hosted device connect-link messaging return target is invalid.",
        retryable: false,
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted internal device-sync connect-link diagnostic.",
      expect.objectContaining({
        errorCode: "HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET",
        errorHttpStatus: 400,
        errorRetryable: false,
        messagingReturnTarget: null,
        provider: "whoop",
        stage: "messaging_return_target",
        status: "failed",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted device-sync settings route failed.",
      expect.objectContaining({
        errorClass: "client_request",
        errorDomain: "device-sync",
        errorHttpStatus: 400,
        errorResponseCode: "HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET",
        errorResponseRetryable: false,
        errorResponseStatus: 400,
        errorRetryable: false,
      }),
    );
  });

  it("maps rejected Cloudflare callbacks to a 401 without starting a connection", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mocks.requireHostedCloudflareCallbackRequest.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized hosted Cloudflare callback request.",
      retryable: false,
    }));

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "whoop",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        message: "Unauthorized hosted Cloudflare callback request.",
        retryable: false,
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted internal device-sync connect-link diagnostic.",
      expect.objectContaining({
        errorCode: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        errorHttpStatus: 401,
        errorRetryable: false,
        messagingReturnTarget: null,
        provider: null,
        stage: "callback_verification",
        status: "failed",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted device-sync settings route failed.",
      expect.objectContaining({
        errorClass: "authorization",
        errorDomain: "hosted-onboarding",
        errorHttpStatus: 401,
        errorResponseCode: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        errorResponseRetryable: false,
        errorResponseStatus: 401,
        errorRetryable: false,
      }),
    );
  });

  it("keeps malformed provider parameters classified as invalid requests", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/%E0%A4%A/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "%E0%A4%A",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request.",
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted internal device-sync connect-link diagnostic.",
      expect.objectContaining({
        messagingReturnTarget: null,
        provider: null,
        stage: "connect_target_param",
        status: "failed",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted device-sync settings route failed.",
      expect.objectContaining({
        errorType: "InvalidRouteParamEncodingError",
      }),
    );
  });

  it("maps callback verification setup failures to a retryable unavailable response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mocks.requireHostedCloudflareCallbackRequest.mockRejectedValue(
      new TypeError("Callback verification is not configured."),
    );

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "whoop",
        }),
      },
    );

    expect(response.status).toBe(503);
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
        message:
          "Hosted device connection links are temporarily unavailable. Please try again shortly.",
        retryable: true,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync settings route failed.",
      expect.objectContaining({
        errorCauseMessage: "Hosted device connect-link backend setup failed.",
        errorCauseType: "HostedDeviceConnectLinkBackendSetupError",
        errorClass: "hosted_device_connect_link_backend_setup",
        errorDomain: "device-sync",
        errorHttpStatus: 503,
        errorPhase: "callback_verification_setup",
        errorResponseCode: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
        errorResponseRetryable: true,
        errorResponseStatus: 503,
        errorRetryable: true,
      }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "Callback verification is not configured",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted internal device-sync connect-link diagnostic.",
      expect.objectContaining({
        errorCode: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
        errorHttpStatus: 503,
        errorRetryable: true,
        messagingReturnTarget: null,
        provider: null,
        stage: "callback_verification",
        status: "failed",
      }),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "Callback verification is not configured",
    );
  });

  it("maps control-plane setup failures to a retryable unavailable response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mocks.createHostedDeviceSyncControlPlane.mockImplementation(() => {
      throw new TypeError("Provider configuration is incomplete.");
    });

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "whoop",
        }),
      },
    );

    expect(response.status).toBe(503);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
        message:
          "Hosted device connection links are temporarily unavailable. Please try again shortly.",
        retryable: true,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync settings route failed.",
      expect.objectContaining({
        errorCauseMessage: "Hosted device connect-link backend setup failed.",
        errorCauseType: "HostedDeviceConnectLinkBackendSetupError",
        errorClass: "hosted_device_connect_link_backend_setup",
        errorDomain: "device-sync",
        errorHttpStatus: 503,
        errorPhase: "control_plane_setup",
        errorResponseCode: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
        errorResponseRetryable: true,
        errorResponseStatus: 503,
        errorRetryable: true,
      }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "Provider configuration is incomplete",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted internal device-sync connect-link diagnostic.",
      expect.objectContaining({
        errorCode: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
        errorHttpStatus: 503,
        errorRetryable: true,
        messagingReturnTarget: null,
        provider: "whoop",
        stage: "control_plane",
        status: "failed",
      }),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "Provider configuration is incomplete",
    );
  });

  it("omits unsafe provider and error code values from diagnostics", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/https%3A%2F%2Fsecret.example%2Foauth%3Fstate%3Dopaque-secret/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "https%3A%2F%2Fsecret.example%2Foauth%3Fstate%3Dopaque-secret",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(mocks.startConnection).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted internal device-sync connect-link diagnostic.",
      expect.objectContaining({
        errorCode: "HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED",
        errorHttpStatus: 404,
        messagingReturnTarget: null,
        provider: null,
        stage: "connect_target_resolution",
        status: "failed",
      }),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret.example");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("opaque-secret");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("secret.example");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("opaque-secret");
  });

  it("rejects GET requests on the internal connect-link route", async () => {
    const response = await internalDeviceSyncConnectLinkRoute.GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message:
          "Hosted internal device-sync connect-link routes only allow POST because starting a connection mutates server state.",
      },
    });
  });
});
