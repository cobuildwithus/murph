import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  createHostedDeviceConnectIntent: vi.fn(),
  ensureMemberOwnedProviderSetup: vi.fn(),
  isHostedThreadContainerMember: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/connect-intents", () => ({
  createHostedDeviceConnectIntent: mocks.createHostedDeviceConnectIntent,
}));

vi.mock("@/src/lib/device-sync/provider-setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/device-sync/provider-setup")>()),
  createMemberOwnedProviderSetupService: vi.fn(() => ({
    ensure: mocks.ensureMemberOwnedProviderSetup,
  })),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  isHostedThreadContainerMember: mocks.isHostedThreadContainerMember,
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
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.isHostedThreadContainerMember.mockResolvedValue(false);
    mocks.ensureMemberOwnedProviderSetup.mockResolvedValue({
      id: "dps_strava_123",
      provider: "strava",
    });
    mocks.createHostedDeviceConnectIntent.mockResolvedValue({
      claim: "dc_opaque",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_opaque&connectSource=whoop",
      expiresAt: "2026-04-04T12:00:00.000Z",
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
    expect(mocks.createHostedDeviceConnectIntent).toHaveBeenCalledWith({
      connectSourceId: "whoop",
      connectTarget: "whoop",
      memberId: "member_123",
      provider: "whoop",
      request: expect.any(Request),
      sourceProviderSlug: null,
    });
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://join.example.test/connect#deviceConnectIntent=dc_opaque&connectSource=whoop",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_opaque&connectSource=whoop",
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
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("join.example.test/connect");
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("opaque-state");
  });

  it("issues a provider-setup intent for Strava without using configured global routes", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "");
    vi.stubEnv("STRAVA_CLIENT_ID", "NON_CREDENTIAL_LEGACY_STRAVA_CLIENT_ID");
    vi.stubEnv("STRAVA_CLIENT_SECRET", "NON_CREDENTIAL_LEGACY_STRAVA_CLIENT_SECRET");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "strava");
    vi.stubEnv("JUNCTION_REGION", "us");
    mocks.createHostedDeviceConnectIntent.mockResolvedValueOnce({
      claim: "dc_strava_setup",
      connectUrl:
        "https://join.example.test/connect#deviceConnectIntent=dc_strava_setup&connectSource=strava",
      expiresAt: "2026-04-04T12:00:00.000Z",
    });

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/connect-targets/strava/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          connectTarget: "strava",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.ensureMemberOwnedProviderSetup).toHaveBeenCalledWith("member_123");
    expect(mocks.createHostedDeviceConnectIntent).toHaveBeenCalledWith({
      connectSourceId: "strava",
      connectTarget: "strava",
      memberId: "member_123",
      provider: "strava",
      providerSetupId: "dps_strava_123",
      request: expect.any(Request),
      sourceProviderSlug: null,
    });
    await expect(response.json()).resolves.toEqual({
      authorizationUrl:
        "https://join.example.test/connect#deviceConnectIntent=dc_strava_setup&connectSource=strava",
      connectUrl:
        "https://join.example.test/connect#deviceConnectIntent=dc_strava_setup&connectSource=strava",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "strava",
      providerLabel: "Strava",
    });
  });

  it("rejects wearable authorization for a synthetic group container", async () => {
    mocks.isHostedThreadContainerMember.mockResolvedValue(true);

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

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_DEVICE_CONNECT_PERSONAL_MEMBER_REQUIRED",
        retryable: false,
      },
    });
    expect(mocks.createHostedDeviceConnectIntent).not.toHaveBeenCalled();
  });

  it("resolves Junction-backed public connect targets at the web boundary", async () => {
    vi.stubEnv("WHOOP_CLIENT_ID", "");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "");
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret-value");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_PROVIDER_FILTER", "fitbit,whoop_v2");
    vi.stubEnv("JUNCTION_REGION", "us");
    mocks.createHostedDeviceConnectIntent.mockResolvedValueOnce({
      claim: "dc_fitbit_opaque",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_fitbit_opaque&connectSource=fitbit",
      expiresAt: "2026-04-04T12:00:00.000Z",
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
    expect(mocks.createHostedDeviceConnectIntent).toHaveBeenCalledWith({
      connectSourceId: "fitbit",
      connectTarget: "fitbit",
      memberId: "member_123",
      provider: "junction",
      request: expect.any(Request),
      sourceProviderSlug: "fitbit",
    });
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://join.example.test/connect#deviceConnectIntent=dc_fitbit_opaque&connectSource=fitbit",
      connectUrl: "https://join.example.test/connect#deviceConnectIntent=dc_fitbit_opaque&connectSource=fitbit",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "fitbit",
      providerLabel: "Fitbit",
    });
  });

  it.each([
    {
      messagingReturnTarget: "imessage",
    },
    {
      messagingReturnTarget: "telegram",
    },
  ] as const)(
    "accepts $messagingReturnTarget as an optional diagnostic hint only",
    async ({ messagingReturnTarget }) => {
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
      expect(mocks.createHostedDeviceConnectIntent).toHaveBeenCalledWith({
        connectSourceId: "whoop",
        connectTarget: "whoop",
        memberId: "member_123",
        provider: "whoop",
        request: expect.any(Request),
        sourceProviderSlug: null,
      });
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
    expect(mocks.createHostedDeviceConnectIntent).not.toHaveBeenCalled();
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
    expect(mocks.createHostedDeviceConnectIntent).not.toHaveBeenCalled();
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
    expect(mocks.createHostedDeviceConnectIntent).not.toHaveBeenCalled();
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
    expect(mocks.createHostedDeviceConnectIntent).not.toHaveBeenCalled();
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

    mocks.createHostedDeviceConnectIntent.mockImplementation(() => {
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
    expect(mocks.createHostedDeviceConnectIntent).toHaveBeenCalledTimes(1);
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
    expect(mocks.createHostedDeviceConnectIntent).not.toHaveBeenCalled();
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
