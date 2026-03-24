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

type ConnectStartRouteModule = typeof import("../app/api/device-sync/oauth/[provider]/start/route");

let startRoute: ConnectStartRouteModule;
let connectRoute: ConnectStartRouteModule;

function createRouteContext(provider: string) {
  return {
    params: Promise.resolve({ provider }),
  };
}

describe("hosted device-sync connect/start route aliases", () => {
  beforeAll(async () => {
    startRoute = await import("../app/api/device-sync/oauth/[provider]/start/route");
    connectRoute = await import("../app/api/device-sync/providers/[provider]/connect/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      assertBrowserMutationOrigin: mocks.assertBrowserMutationOrigin,
      requireAuthenticatedUser: mocks.requireAuthenticatedUser,
      startConnection: mocks.startConnection,
    });
    mocks.requireAuthenticatedUser.mockReturnValue({ id: "user-123" });
    mocks.startConnection.mockResolvedValue({
      authorizationUrl: "https://provider.example.test/oauth/authorize",
    });
  });

  it("exports the same GET and POST handlers for both documented alias paths", () => {
    expect(startRoute.GET).toBe(connectRoute.GET);
    expect(startRoute.POST).toBe(connectRoute.POST);
  });

  it("redirects GET requests to the provider authorization URL", async () => {
    const request = new Request(
      "https://example.test/api/device-sync/oauth/oura%2Flegacy/start?returnTo=https%3A%2F%2Fapp.example.test%2Fdone",
    );

    const response = await startRoute.GET(
      request,
      createRouteContext("oura%2Flegacy"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://provider.example.test/oauth/authorize",
    );
    expect(mocks.assertBrowserMutationOrigin).not.toHaveBeenCalled();
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.startConnection).toHaveBeenCalledWith(
      "user-123",
      "oura/legacy",
      "https://app.example.test/done",
    );
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

  it("preserves POST error responses when the origin check fails", async () => {
    mocks.assertBrowserMutationOrigin.mockImplementation(() => {
      throw new TypeError("Origin denied.");
    });

    const response = await startRoute.POST(
      new Request("https://example.test/api/device-sync/oauth/oura/start", {
        method: "POST",
        body: JSON.stringify({ returnTo: "https://app.example.test/done" }),
      }),
      createRouteContext("oura"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Origin denied.",
      },
    });
    expect(mocks.requireAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.startConnection).not.toHaveBeenCalled();
  });
});
