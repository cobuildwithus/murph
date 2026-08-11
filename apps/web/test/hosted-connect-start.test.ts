import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startHostedDeviceSyncConnection } from "@/src/lib/device-sync/hosted-connect-start";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  assertHostedWhoopConnectCapacityAvailable: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  getPrisma: vi.fn(),
  isDeviceConnectSourceAvailableForConnection: vi.fn(),
  prepareConnectionStart: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@murphai/device-syncd/connect-config", () => ({
  isDeviceConnectSourceAvailableForConnection:
    mocks.isDeviceConnectSourceAvailableForConnection,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService:
    mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/device-sync/whoop-connect-capacity", () => ({
  assertHostedWhoopConnectCapacityAvailable:
    mocks.assertHostedWhoopConnectCapacityAvailable,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

const STRAVA_TARGET = {
  connectSourceId: "strava",
  connectTarget: "strava",
  label: "Strava",
  provider: "strava",
} as const;

const OURA_TARGET = {
  connectSourceId: "oura",
  connectTarget: "oura",
  label: "Oura",
  provider: "oura",
} as const;

const REQUEST = new Request(
  "https://app.example.test/api/connect-sources/oura/start",
  { method: "POST" },
);

const PRISMA = { label: "test-prisma" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEVICE_SYNC_PUBLIC_BASE_URL", "https://app.example.test/api/device-sync");
  vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "");
  vi.stubEnv("HOSTED_WEB_BASE_URL", "https://app.example.test");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");

  mocks.isDeviceConnectSourceAvailableForConnection.mockReturnValue(true);
  mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
    member: { id: "member_a" },
    sessionId: "session_a",
  });
  mocks.getPrisma.mockReturnValue(PRISMA);
  mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
  mocks.assertHostedWhoopConnectCapacityAvailable.mockResolvedValue(undefined);
  mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
    prepareConnectionStart: mocks.prepareConnectionStart,
    startConnection: mocks.startConnection,
  });
  mocks.startConnection.mockResolvedValue({
    authorizationUrl: "https://provider.example.test/oauth/start",
    state: "callback_state_1234567890",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startHostedDeviceSyncConnection", () => {
  it("rejects provider-global direct Strava before creating OAuth state", async () => {
    await expect(startHostedDeviceSyncConnection({
      defaultReturnTo: "/device-sync/connect/complete?source=connect",
      request: REQUEST,
      target: STRAVA_TARGET,
    })).rejects.toMatchObject({
      code: "DEVICE_PROVIDER_SETUP_REQUIRED",
      httpStatus: 409,
    });

    expect(mocks.isDeviceConnectSourceAvailableForConnection).not.toHaveBeenCalled();
    expect(mocks.requireActiveHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("starts provider authorization when the callback uses the app-session hostname", async () => {
    await expect(startHostedDeviceSyncConnection({
      defaultReturnTo: "/device-sync/connect/complete?source=connect",
      request: REQUEST,
      target: OURA_TARGET,
    })).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/start",
      callbackProofCookie: expect.stringContaining("murph-device-sync-oura="),
    });

    expect(mocks.prepareConnectionStart).toHaveBeenCalledWith("member_a", OURA_TARGET);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "member_a",
      "oura",
      "/device-sync/connect/complete?source=connect",
      {
        connectSourceId: "oura",
        connectTarget: "oura",
        sourceProviderSlug: null,
      },
    );
  });

  it("rejects a cross-host callback before OAuth state or provider authorization begins", async () => {
    vi.stubEnv(
      "DEVICE_SYNC_PUBLIC_BASE_URL",
      "https://device-sync.example.test/api/device-sync",
    );

    await expect(startHostedDeviceSyncConnection({
      defaultReturnTo: "/device-sync/connect/complete?source=connect",
      request: REQUEST,
      target: OURA_TARGET,
    })).rejects.toMatchObject({
      cause: {
        errorObservabilityClass: "configuration",
        errorPhase: "browser_oauth_start",
      },
      code: "DEVICE_SYNC_PUBLIC_BASE_URL_HOST_MISMATCH",
      httpStatus: 500,
      message:
        "Hosted browser OAuth callbacks must use the same hostname as the first-party hosted app session "
        + "(app session hostname app.example.test, callback hostname device-sync.example.test). "
        + "Align DEVICE_SYNC_PUBLIC_BASE_URL with the hosted Web public URL.",
      retryable: false,
    });

    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(REQUEST);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
    expect(mocks.assertHostedWhoopConnectCapacityAvailable).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });
});
