import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createRouteContext } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  handleConnectionCallback: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

type CallbackRouteModule = typeof import("../app/api/device-sync/oauth/[provider]/callback/route");
type ConnectCallbackRouteModule = typeof import("../app/api/device-sync/connect/[provider]/callback/route");

let callbackRoute: CallbackRouteModule;
let connectCallbackRoute: ConnectCallbackRouteModule;

describe("hosted device-sync callback route", () => {
  beforeAll(async () => {
    callbackRoute = await import("../app/api/device-sync/oauth/[provider]/callback/route");
    connectCallbackRoute = await import("../app/api/device-sync/connect/[provider]/callback/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      handleConnectionCallback: mocks.handleConnectionCallback,
    });
    mocks.handleConnectionCallback.mockResolvedValue({
      account: {
        id: "dsc_123",
        provider: "oura",
      },
      returnTo: null,
    });
  });

  it("uses provider-only callback params in redirects", async () => {
    mocks.handleConnectionCallback.mockResolvedValue({
      account: {
        id: "dsc_123",
        provider: "oura",
      },
      returnTo: "https://app.example.test/settings",
    });

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(302);
    expect(mocks.handleConnectionCallback.mock.calls).toEqual([["oura"]]);
    const location = response.headers.get("location");
    expect(location).toContain("deviceSyncStatus=connected");
    expect(location).toContain("deviceSyncProvider=oura");
    expect(location).not.toContain("deviceSyncConnectionId");
    expect(location).not.toContain("dsc_123");
  });

  it("serves the generic connect callback route for external-link providers", async () => {
    mocks.handleConnectionCallback.mockResolvedValue({
      account: {
        id: "dsc_junction",
        provider: "junction",
      },
      returnTo: "https://app.example.test/settings?tab=wearables",
    });

    const response = await connectCallbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/connect/junction/callback?murph_state=xyz&result=success"),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    expect(mocks.handleConnectionCallback.mock.calls).toEqual([["junction"]]);
    const location = response.headers.get("location");
    expect(location).toContain("deviceSyncStatus=connected");
    expect(location).toContain("deviceSyncProvider=junction");
    expect(location).not.toContain("dsc_junction");
  });

  it("adds callback params to the device connect completion return target", async () => {
    mocks.handleConnectionCallback.mockResolvedValue({
      account: {
        id: "dsc_junction",
        provider: "junction",
      },
      returnTo:
        "https://app.example.test/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
    });

    const response = await connectCallbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/connect/junction/callback?murph_state=xyz&result=success"),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const destination = new URL(location!);
    expect(destination.origin).toBe("https://app.example.test");
    expect(destination.pathname).toBe("/device-sync/connect/complete");
    expect(destination.searchParams.get("source")).toBe("connect");
    expect(destination.searchParams.get("connectSource")).toBe("garmin");
    expect(destination.searchParams.get("connectTarget")).toBe("garmin");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("connected");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("junction");
    expect(destination.searchParams.get("deviceSyncConnectionId")).toBeNull();
  });

  it("preserves source intent on generic connect callback error redirects", async () => {
    mocks.handleConnectionCallback.mockRejectedValue(deviceSyncError({
      code: "OAUTH_CALLBACK_REJECTED",
      message: "OAuth authorization was denied or canceled.",
      retryable: false,
      httpStatus: 400,
      details: {
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        returnTo: "https://app.example.test/connect",
      },
    }));

    const response = await connectCallbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/connect/junction/callback?murph_state=xyz&result=error"),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toContain("deviceSyncStatus=error");
    expect(location).toContain("deviceSyncProvider=junction");
    expect(location).toContain("deviceSyncError=OAUTH_CALLBACK_REJECTED");
    expect(location).toContain("connectSource=garmin");
    expect(location).toContain("connectTarget=garmin");
  });

  it("redirects stale disconnected connect callbacks through completion return targets", async () => {
    mocks.handleConnectionCallback.mockRejectedValue(deviceSyncError({
      code: "CONNECTION_ALREADY_DISCONNECTED",
      message: "Device sync connection callback was received after the seeded account was disconnected.",
      retryable: false,
      httpStatus: 409,
      details: {
        accountId: "dsc_seeded_1",
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        returnTo:
          "https://app.example.test/device-sync/connect/complete?source=connect&connectSource=garmin&connectTarget=garmin",
      },
    }));

    const response = await connectCallbackRoute.GET(
      new Request(
        "https://control.example.test/api/device-sync/connect/junction/callback?murph_state=xyz&state=success&isMobile=false&provider=garmin",
      ),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const destination = new URL(location!);
    expect(destination.origin).toBe("https://app.example.test");
    expect(destination.pathname).toBe("/device-sync/connect/complete");
    expect(destination.searchParams.get("source")).toBe("connect");
    expect(destination.searchParams.get("connectSource")).toBe("garmin");
    expect(destination.searchParams.get("connectTarget")).toBe("garmin");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("error");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("junction");
    expect(destination.searchParams.get("deviceSyncError")).toBe("CONNECTION_ALREADY_DISCONNECTED");
    expect(destination.searchParams.get("deviceSyncConnectionId")).toBeNull();
    expect(location).not.toContain("Device sync connection callback");
    expect(location).not.toContain("dsc_seeded_1");
    expect(location).not.toContain("dsc_");
  });

  it("uses generic callback html when device errors cannot redirect safely", async () => {
    mocks.handleConnectionCallback.mockRejectedValue(deviceSyncError({
      code: "CONNECTION_ALREADY_DISCONNECTED",
      message: "Device sync connection callback was received after the seeded account was disconnected.",
      retryable: false,
      httpStatus: 409,
      details: {
        accountId: "dsc_seeded_1",
        provider: "junction",
        returnTo: "javascript:alert(1)",
      },
    }));

    const response = await connectCallbackRoute.GET(
      new Request(
        "https://control.example.test/api/device-sync/connect/junction/callback?murph_state=xyz&state=success",
      ),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("Device connection failed");
    expect(html).toContain("Please retry from Murph.");
    expect(html).not.toContain("seeded account");
    expect(html).not.toContain("dsc_seeded_1");
    expect(html).not.toContain("dsc_");
    expect(html).not.toContain("CONNECTION_ALREADY_DISCONNECTED");
    expect(html).not.toContain("javascript");
  });

  it("does not include the raw connection id in the fallback callback html", async () => {
    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Connected oura successfully.");
    expect(html).not.toContain("dsc_123");
  });

  it("returns callback html instead of json for unexpected callback failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValue(new Error("boom"));

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("Device connection failed");
    expect(html).toContain("Please retry from Murph.");
    expect(html).not.toContain('"error"');
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync connection callback failed unexpectedly.",
      expect.objectContaining({
        errorType: "Error",
        provider: "oura",
      }),
    );
  });

  it("returns callback html when provider route-param decoding fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/%25E0%25A4%25A/callback?code=abc&state=xyz"),
      createRouteContext({ provider: "%E0%A4%A" }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("Device connection failed");
    expect(html).toContain("callback URL was invalid");
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("falls back to callback html when the stored returnTo is not a safe redirect URL", async () => {
    mocks.handleConnectionCallback.mockResolvedValue({
      account: {
        id: "dsc_123",
        provider: "oura",
      },
      returnTo: "javascript:alert(1)",
    });

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("Connected oura successfully.");
  });

  it("keeps unexpected type errors on the 500 callback html path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValue(new TypeError("boom"));

    const response = await callbackRoute.GET(
      new Request("https://control.example.test/api/device-sync/oauth/oura/callback?code=abc&state=xyz"),
      createRouteContext({ provider: "oura" }),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Please retry from Murph.");
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync connection callback failed unexpectedly.",
      expect.objectContaining({
        errorType: "TypeError",
        provider: "oura",
      }),
    );
  });
});
