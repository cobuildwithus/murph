import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeGoogleHealthFitbitMigration: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveDecodedRouteParam: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService:
    mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/http")>(),
  resolveDecodedRouteParam: mocks.resolveDecodedRouteParam,
}));

describe("hosted Fitbit migration cutover route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.resolveDecodedRouteParam.mockResolvedValue("dsc_fitbit");
    mocks.completeGoogleHealthFitbitMigration.mockResolvedValue({
      connectionId: "dsc_fitbit",
      status: "complete",
    });
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      completeGoogleHealthFitbitMigration:
        mocks.completeGoogleHealthFitbitMigration,
    });
  });

  it("rejects unsigned reads", async () => {
    const { GET } = await import(
      "../app/api/internal/device-sync/fitbit-migration/cutover/route"
    );

    const response = await GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
  });

  it("runs exact-connection cutover for the signed runtime principal", async () => {
    const { POST } = await import(
      "../app/api/internal/device-sync/fitbit-migration/cutover/route"
    );
    const request = new Request(
      "https://join.example.test/api/internal/device-sync/fitbit-migration/cutover",
      {
        body: JSON.stringify({ connectionId: "dsc_fitbit" }),
        method: "POST",
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 4 * 1024 },
    );
    expect(mocks.completeGoogleHealthFitbitMigration).toHaveBeenCalledWith(
      "member_123",
      "dsc_fitbit",
    );
    await expect(response.json()).resolves.toEqual({
      connectionId: "dsc_fitbit",
      status: "complete",
    });
  });

  it("runs the same guarded cutover for an authenticated browser retry", async () => {
    const { POST } = await import(
      "../app/api/settings/device-sync/connections/[connectionId]/fitbit-migration/cutover/route"
    );
    const request = new Request(
      "https://join.example.test/api/settings/device-sync/connections/dsc_fitbit/fitbit-migration/cutover",
      { method: "POST" },
    );

    const response = await POST(request, {
      params: Promise.resolve({ connectionId: "dsc_fitbit" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      request,
    );
    expect(
      mocks.requireActiveHostedAppSessionFromRequest,
    ).toHaveBeenCalledWith(request);
    expect(mocks.completeGoogleHealthFitbitMigration).toHaveBeenCalledWith(
      "member_123",
      "dsc_fitbit",
    );
  });
});
