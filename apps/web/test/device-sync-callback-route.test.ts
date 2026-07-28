import { renderToStaticMarkup } from "react-dom/server";

import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildHostedDeviceSyncCallbackProof } from "@/src/lib/device-sync/browser-callback-proof";

import { createRouteContext } from "./route-test-helpers";

vi.mock("server-only", () => ({}));

const CALLBACK_STATE = "callback_state_1234567890";
const CALLBACK_URL =
  `https://control.example.test/api/device-sync/connect/junction/callback`
  + `?murph_state=${CALLBACK_STATE}&result=success`;

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  discardConnectionCallback: vi.fn(),
  handleConnectionCallback: vi.fn(),
  nextHeaders: vi.fn(),
  requireActiveHostedAppSession: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.nextHeaders,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

type CallbackPageModule =
  typeof import("../app/api/device-sync/connect/[provider]/callback/page");
type CallbackCompletionRouteModule =
  typeof import("../app/api/device-sync/connect/[provider]/callback/complete/route");

let callbackPage: CallbackPageModule;
let callbackCompletionRoute: CallbackCompletionRouteModule;

describe("hosted device-sync callback boundary", () => {
  beforeAll(async () => {
    callbackPage = await import("../app/api/device-sync/connect/[provider]/callback/page");
    callbackCompletionRoute = await import(
      "../app/api/device-sync/connect/[provider]/callback/complete/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEVICE_SYNC_PUBLIC_BASE_URL", "https://control.example.test/api/device-sync");
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      discardConnectionCallback: mocks.discardConnectionCallback,
      handleConnectionCallback: mocks.handleConnectionCallback,
    });
    mocks.discardConnectionCallback.mockResolvedValue(undefined);
    mocks.handleConnectionCallback.mockResolvedValue({
      account: {
        id: "dsc_junction",
        provider: "junction",
      },
      connectSourceId: "garmin",
      connectTarget: "garmin",
      returnTo:
        "https://control.example.test/device-sync/connect/complete"
        + "?source=connect&connectSource=garmin&connectTarget=garmin",
    });
    mocks.requireActiveHostedAppSession.mockResolvedValue({
      member: { id: "member_a" },
      sessionId: "session_a",
    });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_a" },
      sessionId: "session_a",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders confirmation without exchanging provider credentials on callback GET", async () => {
    const cookie = buildProofCookie();
    mocks.nextHeaders.mockResolvedValue(new Headers({ cookie }));

    const element = await callbackPage.default({
      params: Promise.resolve({ provider: "junction" }),
      searchParams: Promise.resolve({
        murph_state: CALLBACK_STATE,
        result: "success",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Finish connecting your device");
    expect(html).toContain("Finish connection");
    expect(html).toContain(
      `/api/device-sync/connect/junction/callback/complete`
      + `?murph_state=${CALLBACK_STATE}&amp;result=success`,
    );
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
    expect(mocks.discardConnectionCallback).not.toHaveBeenCalled();
  });

  it("burns the callback state when the transferable URL reaches a browser without its proof", async () => {
    mocks.nextHeaders.mockResolvedValue(new Headers());

    const element = await callbackPage.default({
      params: Promise.resolve({ provider: "junction" }),
      searchParams: Promise.resolve({
        murph_state: CALLBACK_STATE,
        result: "success",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Connection not completed");
    expect(html).toContain("Nothing was connected from it.");
    expect(mocks.discardConnectionCallback).toHaveBeenCalledWith("junction");
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
  });

  it("completes only after a same-origin POST presents the matching browser proof", async () => {
    const request = buildCompletionRequest();

    const response = await callbackCompletionRoute.POST(
      request,
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.handleConnectionCallback).toHaveBeenCalledWith("junction", {
      expectedOwnerId: "member_a",
    });
    expect(mocks.discardConnectionCallback).not.toHaveBeenCalled();
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/device-sync/connect/complete");
    expect(destination.searchParams.get("deviceSyncStatus")).toBe("connected");
    expect(destination.searchParams.get("deviceSyncProvider")).toBe("junction");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects a relayed completion URL without the initiating browser proof", async () => {
    const request = new Request(CALLBACK_URL.replace(
      "/callback?",
      "/callback/complete?",
    ), {
      headers: {
        origin: "https://control.example.test",
      },
      method: "POST",
    });

    const response = await callbackCompletionRoute.POST(
      request,
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.discardConnectionCallback).toHaveBeenCalledWith("junction");
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects the initiating browser proof when the active member changes", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: { id: "member_b" },
      sessionId: "session_b",
    });

    const response = await callbackCompletionRoute.POST(
      buildCompletionRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.discardConnectionCallback).toHaveBeenCalledWith("junction");
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
  });

  it("does not touch callback state when same-origin mutation authority is absent", async () => {
    mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
      throw new TypeError("cross-origin");
    });

    const response = await callbackCompletionRoute.POST(
      buildCompletionRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(500);
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
    expect(mocks.discardConnectionCallback).not.toHaveBeenCalled();
    expect(mocks.handleConnectionCallback).not.toHaveBeenCalled();
  });

  it("preserves source intent on provider callback error redirects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValueOnce(deviceSyncError({
      code: "OAUTH_CALLBACK_REJECTED",
      details: {
        connectSourceId: "garmin",
        connectTarget: "garmin",
        provider: "junction",
        returnTo: "https://control.example.test/connect",
      },
      httpStatus: 400,
      message: "OAuth authorization was denied or canceled.",
      retryable: false,
    }));

    const response = await callbackCompletionRoute.POST(
      buildCompletionRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("deviceSyncStatus=error");
    expect(location).toContain("deviceSyncError=OAUTH_CALLBACK_REJECTED");
    expect(location).toContain("connectSource=garmin");
    expect(location).toContain("connectTarget=garmin");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("sends replayed callbacks back without asserting a second outcome", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValueOnce(deviceSyncError({
      code: "OAUTH_STATE_REPLAYED",
      details: {
        provider: "junction",
        returnTo:
          "https://control.example.test/device-sync/connect/complete"
          + "?source=assistant&deviceSyncStatus=connected",
      },
      httpStatus: 409,
      message: "OAuth callback state was already handled by an earlier delivery.",
      retryable: false,
    }));

    const response = await callbackCompletionRoute.POST(
      buildCompletionRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.searchParams.get("source")).toBe("assistant");
    expect(destination.searchParams.get("deviceSyncStatus")).toBeNull();
    expect(destination.searchParams.get("deviceSyncError")).toBeNull();
  });

  it("returns generic callback HTML for unexpected completion failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handleConnectionCallback.mockRejectedValueOnce(new Error("boom"));

    const response = await callbackCompletionRoute.POST(
      buildCompletionRequest(),
      createRouteContext({ provider: "junction" }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("Please retry from Murph.");
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted device-sync connection callback failed unexpectedly.",
      expect.objectContaining({
        errorType: "Error",
        provider: "junction",
      }),
    );
  });

  it("returns safe callback HTML when provider route decoding fails", async () => {
    const response = await callbackCompletionRoute.POST(
      buildCompletionRequest(),
      createRouteContext({ provider: "%E0%A4%A" }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("callback URL was invalid");
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });
});

function buildProofCookie(): string {
  const { cookie } = buildHostedDeviceSyncCallbackProof({
    memberId: "member_a",
    provider: "junction",
    sessionId: "session_a",
    state: CALLBACK_STATE,
  });
  return cookie.split(";", 1)[0] ?? "";
}

function buildCompletionRequest(): Request {
  return new Request(
    CALLBACK_URL.replace("/callback?", "/callback/complete?"),
    {
      headers: {
        cookie: buildProofCookie(),
        origin: "https://control.example.test",
      },
      method: "POST",
    },
  );
}
