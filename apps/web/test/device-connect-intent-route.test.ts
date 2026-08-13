import { Buffer } from "node:buffer";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import { MemberOwnedProviderSetup } from "@/src/components/device-sync/member-owned-provider-setup";
import {
  STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
} from "@/src/lib/device-sync/provider-setup/registry";
import { MemberOwnedProviderSetupService } from "@/src/lib/device-sync/provider-setup/service";
import type {
  MemberOwnedProviderSetupConnectionDisposition,
  MemberOwnedProviderSetupRecord,
} from "@/src/lib/device-sync/provider-setup/types";
import type { ResolvedDeviceProviderApplication } from "@/src/lib/device-sync/provider-applications";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  authorizeMemberOwnedProviderSetup: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  claimHostedDeviceConnectIntentForStart: vi.fn(),
  createMemberOwnedProviderSetupService: vi.fn(),
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
  createMemberOwnedProviderSetupService:
    mocks.createMemberOwnedProviderSetupService,
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
    vi.stubEnv(
      "HOSTED_APP_SESSION_HMAC_KEY",
      Buffer.alloc(32, 1).toString("base64url"),
    );
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://join.example.test");
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
    mocks.authorizeMemberOwnedProviderSetup.mockResolvedValue({
      action: "none",
      applicationRevision: null,
      connected: false,
      message: "Murph can continue this private provider setup from Connect.",
      provider: "strava",
      setupId: "dps_synthetic",
      status: "authorized",
      updatedAt: "2026-08-11T12:00:00.000Z",
    });
    mocks.createMemberOwnedProviderSetupService.mockReturnValue({
      authorizeAndContinue: mocks.authorizeMemberOwnedProviderSetup,
      startOAuth: mocks.startMemberOwnedProviderSetupOAuth,
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
    expect(mocks.authorizeMemberOwnedProviderSetup).not.toHaveBeenCalled();
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

  it("authorizes an exact member-owned Strava setup and returns safely to Connect", async () => {
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
    expect(response.headers.get("location")).toBe("/connect#connectSource=strava");
    expect(mocks.authorizeMemberOwnedProviderSetup).toHaveBeenCalledWith(
      "member_123",
      "dps_synthetic",
    );
    expect(mocks.releaseHostedDeviceConnectIntentStart).toHaveBeenCalledWith({
      claim: "dc_opaque",
      memberId: "member_123",
    });
    expect(mocks.startMemberOwnedProviderSetupOAuth).not.toHaveBeenCalled();
    expect(mocks.startHostedDeviceSyncConnection).not.toHaveBeenCalled();
  });

  it("continues an exact reauthorization-required signed setup intent through the existing OAuth owner", async () => {
    const fixture = createReauthorizationRequiredSetupFixture();
    mocks.createMemberOwnedProviderSetupService.mockReturnValueOnce(fixture.service);
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
        headers: {
          accept: "application/json",
        },
        method: "POST",
      }),
      createRouteContext({ claim: "dc_opaque" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://www.strava.com/oauth/authorize?reauthorize=1",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "murph-device-sync-strava=",
    );
    expect(fixture.startConnection).toHaveBeenCalledWith(
      "member_123",
      {
        applicationId: "dpa_synthetic",
        provider: "strava",
        revision: 3,
      },
      "/device-sync/connect/complete?source=assistant&connectSource=strava&connectTarget=strava",
      {
        connectSourceId: "strava",
        connectTarget: "strava",
        sourceProviderSlug: null,
      },
    );
    expect(fixture.readSetup()).toMatchObject({
      providerApplicationId: "dpa_synthetic",
      providerApplicationRevision: 3,
      status: "oauth_in_progress",
    });
    expect(mocks.releaseHostedDeviceConnectIntentStart).not.toHaveBeenCalled();
  });

  it("renders the direct member-owned Connect state as one truthful OAuth continuation", async () => {
    const fixture = createReauthorizationRequiredSetupFixture();
    const setup = await fixture.service.read("member_123");
    expect(setup).toMatchObject({
      action: "continue_oauth",
      applicationRevision: 3,
      connected: false,
      status: "oauth_ready",
    });
    const markup = renderToStaticMarkup(createElement(MemberOwnedProviderSetup, {
      connected: setup?.connected === true,
      onAction: vi.fn(),
      pending: false,
      presentation: STRAVA_MEMBER_OWNED_PROVIDER_SETUP_PRESENTATION,
      setup,
    }));

    expect(markup).toContain("Ready for consent");
    expect(markup).toContain("Your private Strava application is ready");
    expect(markup).toContain("Private application revision 3");
    expect(markup).toContain("Read-only activity access");
    expect(markup).toContain("Continue with Strava");
    expect(markup.match(/<button\b/gu)).toHaveLength(1);
    expect(markup).not.toContain("Strava is connected through your private provider application");
    expect(markup).not.toContain(">Connected<");
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

const REAUTHORIZATION_NOW = new Date("2026-08-11T12:00:00.000Z");
const REAUTHORIZATION_APPLICATION: ResolvedDeviceProviderApplication = {
  applicationId: "dpa_synthetic",
  provider: "strava",
  providerConfigs: {
    strava: {
      clientId: "NON_CREDENTIAL_TEST_CLIENT_ID",
      clientSecret: "NON_CREDENTIAL_TEST_CLIENT_SECRET",
    },
  },
  revision: 3,
};

type ProviderSetupServiceInput = NonNullable<
  ConstructorParameters<typeof MemberOwnedProviderSetupService>[1]
>;
type ProviderSetupStore = NonNullable<ProviderSetupServiceInput["store"]>;

function createReauthorizationRequiredSetupFixture() {
  let setup: MemberOwnedProviderSetupRecord = {
    active: true,
    browserRunId: null,
    completedAt: REAUTHORIZATION_NOW,
    connectSourceId: "strava",
    connectTarget: "strava",
    createdAt: REAUTHORIZATION_NOW,
    id: "dps_synthetic",
    memberId: "member_123",
    provider: "strava",
    providerApplicationId: REAUTHORIZATION_APPLICATION.applicationId,
    providerApplicationRevision: REAUTHORIZATION_APPLICATION.revision,
    sourceProviderSlug: null,
    status: "connected",
    updatedAt: REAUTHORIZATION_NOW,
    version: 1,
  };
  const disposition: MemberOwnedProviderSetupConnectionDisposition = {
    binding: {
      applicationId: REAUTHORIZATION_APPLICATION.applicationId,
      provider: "strava",
      revision: REAUTHORIZATION_APPLICATION.revision,
    },
    connectionId: "dsc_reauthorization_required",
    kind: "exact",
    status: "reauthorization_required",
  };
  const store: ProviderSetupStore = {
    ensureActive: async () => setup,
    listMemberSetups: async () => [setup],
    markConnectedForExactApplication: async () => setup,
    markDisconnected: async () => setup,
    readActive: async () => setup,
    readConnectionDisposition: async () => disposition,
    readOwned: async (input) => {
      expect(input).toEqual({
        memberId: setup.memberId,
        provider: setup.provider,
        setupId: setup.id,
      });
      return setup;
    },
    transition: async (input) => {
      expect(input.expectedVersion).toBe(setup.version);
      expect(input.memberId).toBe(setup.memberId);
      expect(input.provider).toBe(setup.provider);
      expect(input.setupId).toBe(setup.id);
      setup = {
        ...setup,
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.browserRunId === undefined
          ? {}
          : { browserRunId: input.browserRunId }),
        ...(input.completedAt === undefined
          ? {}
          : { completedAt: input.completedAt }),
        ...(input.providerApplicationId === undefined
          ? {}
          : { providerApplicationId: input.providerApplicationId }),
        ...(input.providerApplicationRevision === undefined
          ? {}
          : { providerApplicationRevision: input.providerApplicationRevision }),
        status: input.status,
        updatedAt: new Date(setup.updatedAt.getTime() + 1_000),
        version: setup.version + 1,
      };
      return setup;
    },
  };
  const startConnection = vi.fn(async () => ({
    authorizationUrl: "https://www.strava.com/oauth/authorize?reauthorize=1",
    state: "synthetic_reauthorization_state_1234567890",
  }));
  const service = new MemberOwnedProviderSetupService("strava", {
    createIngress: () => ({
      startConnectionWithProviderApplication: startConnection,
    }),
    now: () => REAUTHORIZATION_NOW,
    readApplicationView: async () => null,
    resolveApplication: async () => REAUTHORIZATION_APPLICATION,
    store,
  });
  return {
    readSetup: () => setup,
    service,
    startConnection,
  };
}
