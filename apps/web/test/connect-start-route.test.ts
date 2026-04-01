import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertBrowserMutationOrigin: vi.fn(),
  createHostedDeviceSyncControlPlane: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  startConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type ConnectRouteModule = typeof import("../app/api/device-sync/providers/[provider]/connect/route");

let connectRoute: ConnectRouteModule;

function createRouteContext(provider: string) {
  return {
    params: Promise.resolve({ provider }),
  };
}

describe("hosted device-sync connect route", () => {
  beforeAll(async () => {
    connectRoute = await import("../app/api/device-sync/providers/[provider]/connect/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      assertBrowserMutationOrigin: mocks.assertBrowserMutationOrigin,
      requireAuthenticatedUser: mocks.requireAuthenticatedUser,
      startConnection: mocks.startConnection,
    });
    mocks.requireAuthenticatedUser.mockResolvedValue({ id: "user-123" });
    mocks.startConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth/authorize",
    });
  });

  it("rejects GET requests because connect-start is POST-only", async () => {
    const request = new Request(
      "https://example.test/api/device-sync/providers/oura%2Flegacy/connect?returnTo=https%3A%2F%2Fapp.example.test%2Fdone",
    );

    const response = await connectRoute.GET(
      request,
      createRouteContext("oura%2Flegacy"),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message:
          "Hosted device-sync connect/start routes only allow POST because starting a connection mutates server state.",
      },
    });
    expect(mocks.assertBrowserMutationOrigin).not.toHaveBeenCalled();
    expect(mocks.requireAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });

  it("returns JSON from POST and treats a missing returnTo as null", async () => {
    const request = new Request(
      "https://example.test/api/device-sync/providers/whoop/connect",
      {
        method: "POST",
      },
    );

    const response = await connectRoute.POST(
      request,
      createRouteContext("whoop"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorizationUrl: "https://provider.example.test/oauth/authorize",
    });
    expect(mocks.assertBrowserMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "user-123",
      "whoop",
      null,
    );
  });

  it("preserves POST error responses when the browser origin check fails", async () => {
    mocks.assertBrowserMutationOrigin.mockImplementation(() => {
      throw deviceSyncError({
        code: "CSRF_ORIGIN_INVALID",
        message: "Mutation origin https://evil.example.test is not allowed for hosted device-sync routes.",
        httpStatus: 403,
        details: {
          origin: "https://evil.example.test",
        },
      });
    });

    const response = await connectRoute.POST(
      new Request("https://example.test/api/device-sync/providers/oura/connect", {
        method: "POST",
        body: JSON.stringify({ returnTo: "https://app.example.test/done" }),
      }),
      createRouteContext("oura"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CSRF_ORIGIN_INVALID",
        message: "Mutation origin https://evil.example.test is not allowed for hosted device-sync routes.",
        retryable: false,
      },
    });
    expect(mocks.requireAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });
});
