import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  handleOAuthCallback: vi.fn(),
  toBrowserConnection: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type CallbackRouteModule = typeof import("../app/api/device-sync/oauth/[provider]/callback/route");

let callbackRoute: CallbackRouteModule;

function createRouteContext(provider: string) {
  return {
    params: Promise.resolve({ provider }),
  };
}

describe("hosted device-sync callback route", () => {
  beforeAll(async () => {
    callbackRoute = await import("../app/api/device-sync/oauth/[provider]/callback/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      handleOAuthCallback: mocks.handleOAuthCallback,
      toBrowserConnection: mocks.toBrowserConnection,
    });
    mocks.handleOAuthCallback.mockResolvedValue({
      account: {
        id: "dsc_123",
        provider: "oura",
      },
      returnTo: null,
    });
    mocks.toBrowserConnection.mockReturnValue({
      id: "dspc_public_123",
      provider: "oura",
    });
  });

  it("uses the opaque browser connection id in callback redirects", async () => {
    mocks.handleOAuthCallback.mockResolvedValue({
      account: {
        id: "dsc_123",
        provider: "oura",
      },
      returnTo: "https://app.example.test/settings",
    });

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext("oura"),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toContain("deviceSyncConnectionId=dspc_public_123");
    expect(location).not.toContain("dsc_123");
  });

  it("does not include the raw connection id in the fallback callback html", async () => {
    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext("oura"),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Connected oura successfully.");
    expect(html).not.toContain("dsc_123");
  });

  it("returns callback html instead of json for unexpected callback failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handleOAuthCallback.mockRejectedValue(new Error("boom"));

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext("oura"),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("Device connection failed");
    expect(html).toContain("Please retry from Murph.");
    expect(html).not.toContain('"error"');
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync OAuth callback failed unexpectedly.",
      expect.objectContaining({
        error: expect.any(Error),
        provider: "oura",
      }),
    );
  });

  it("returns callback html when provider route-param decoding fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/%25E0%25A4%25A/callback?code=abc&state=xyz"),
      createRouteContext("%E0%A4%A"),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("Device connection failed");
    expect(html).toContain("Please retry from Murph.");
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync OAuth callback failed unexpectedly.",
      expect.objectContaining({
        error: expect.any(Error),
        provider: null,
      }),
    );
  });
});
