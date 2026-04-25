import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

type InternalDeviceSyncConnectLinkRouteModule = typeof import(
  "../app/api/internal/device-sync/providers/[provider]/connect-link/route"
);

let internalDeviceSyncConnectLinkRoute: InternalDeviceSyncConnectLinkRouteModule;

describe("device sync internal connect-link route", () => {
  beforeAll(async () => {
    internalDeviceSyncConnectLinkRoute = await import(
      "../app/api/internal/device-sync/providers/[provider]/connect-link/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
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
  });

  it("creates a hosted device connect link for the verified Cloudflare callback principal", async () => {
    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "whoop",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_123",
      "whoop",
      "/settings?tab=wearables",
    );
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
      expiresAt: "2026-04-04T12:00:00.000Z",
      provider: "whoop",
      providerLabel: "WHOOP",
    });
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
      new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "whoop",
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
      new Request("https://join.example.test/api/internal/device-sync/providers/%E0%A4%A/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "%E0%A4%A",
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
      "Hosted device-sync settings route failed.",
      expect.objectContaining({
        errorType: "InvalidRouteParamEncodingError",
      }),
    );
  });

  it("maps callback verification setup failures to a retryable unavailable response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.requireHostedCloudflareCallbackRequest.mockRejectedValue(
      new TypeError("Callback verification is not configured."),
    );

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "whoop",
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
  });

  it("maps control-plane setup failures to a retryable unavailable response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.createHostedDeviceSyncControlPlane.mockImplementation(() => {
      throw new TypeError("Provider configuration is incomplete.");
    });

    const response = await internalDeviceSyncConnectLinkRoute.POST(
      new Request("https://join.example.test/api/internal/device-sync/providers/whoop/connect-link", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          provider: "whoop",
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
