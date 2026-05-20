import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  ackHostedDeviceSyncDirtyStateProcessed: vi.fn(),
  readHostedDeviceSyncPendingDirtyState: vi.fn(),
  readHostedDeviceSyncRuntimeState: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/device-sync/hosted-runtime-authority", () => ({
  ackHostedDeviceSyncDirtyStateProcessed: mocks.ackHostedDeviceSyncDirtyStateProcessed,
  readHostedDeviceSyncPendingDirtyState: mocks.readHostedDeviceSyncPendingDirtyState,
  readHostedDeviceSyncRuntimeState: mocks.readHostedDeviceSyncRuntimeState,
}));

type SnapshotRouteModule =
  typeof import("../app/api/internal/device-sync/runtime/snapshot/route");
type DirtyPendingRouteModule =
  typeof import("../app/api/internal/device-sync/runtime/dirty-pending/route");
type DirtyAckRouteModule =
  typeof import("../app/api/internal/device-sync/runtime/dirty-ack/route");

let snapshotRoute: SnapshotRouteModule;
let dirtyPendingRoute: DirtyPendingRouteModule;
let dirtyAckRoute: DirtyAckRouteModule;

describe("device-sync internal runtime routes", () => {
  beforeAll(async () => {
    snapshotRoute = await import("../app/api/internal/device-sync/runtime/snapshot/route");
    dirtyPendingRoute = await import(
      "../app/api/internal/device-sync/runtime/dirty-pending/route"
    );
    dirtyAckRoute = await import("../app/api/internal/device-sync/runtime/dirty-ack/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_runtime_1");
    mocks.readHostedDeviceSyncRuntimeState.mockResolvedValue({
      connections: [],
      schema: "murph.hosted-device-sync-runtime-state.v1",
    });
    mocks.readHostedDeviceSyncPendingDirtyState.mockResolvedValue({
      dirty: [],
      schema: "murph.hosted-device-sync-dirty-state.v1",
    });
    mocks.ackHostedDeviceSyncDirtyStateProcessed.mockResolvedValue({
      acked: true,
      schema: "murph.hosted-device-sync-dirty-ack.v1",
    });
  });

  it.each([
    {
      get: () => snapshotRoute.GET(),
      message:
        "Hosted internal device-sync runtime snapshot routes only allow POST because the callback request is signed over the JSON body.",
      name: "snapshot",
    },
    {
      get: () => dirtyPendingRoute.GET(),
      message:
        "Hosted internal device-sync dirty-pending routes only allow POST because the callback request is signed over the JSON body.",
      name: "dirty-pending",
    },
    {
      get: () => dirtyAckRoute.GET(),
      message:
        "Hosted internal device-sync dirty-ack routes only allow POST because the callback request is signed over the JSON body.",
      name: "dirty-ack",
    },
  ])("rejects GET on the $name route with the exposed method metadata", async ({ get, message }) => {
    const response = await get();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message,
      },
    });
  });

  it.each([
    {
      authorityMock: mocks.readHostedDeviceSyncRuntimeState,
      name: "snapshot",
      post: (request: Request) => snapshotRoute.POST(request),
    },
    {
      authorityMock: mocks.readHostedDeviceSyncPendingDirtyState,
      name: "dirty-pending",
      post: (request: Request) => dirtyPendingRoute.POST(request),
    },
    {
      authorityMock: mocks.ackHostedDeviceSyncDirtyStateProcessed,
      name: "dirty-ack",
      post: (request: Request) => dirtyAckRoute.POST(request),
    },
  ])("rejects unauthenticated $name callbacks before service delegation", async ({ authorityMock, post }) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.requireHostedCloudflareCallbackRequest.mockRejectedValueOnce(hostedOnboardingError({
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        httpStatus: 401,
        message: "Unauthorized hosted Cloudflare callback request.",
        retryable: false,
      }));

      const response = await post(jsonRequest({ requestId: "request_auth_failure" }));

      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(authorityMock).not.toHaveBeenCalled();
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
          errorResponseStatus: 401,
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("delegates snapshot POST with the original request and trusted user id", async () => {
    const request = jsonRequest({ requestId: "request_snapshot" });

    const response = await snapshotRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readHostedDeviceSyncRuntimeState).toHaveBeenCalledWith({
      request,
      trustedUserId: "member_runtime_1",
    });
    await expect(response.json()).resolves.toEqual({
      connections: [],
      schema: "murph.hosted-device-sync-runtime-state.v1",
    });
  });

  it("delegates dirty-pending POST with the original request and trusted user id", async () => {
    const request = jsonRequest({ requestId: "request_dirty_pending" });

    const response = await dirtyPendingRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readHostedDeviceSyncPendingDirtyState).toHaveBeenCalledWith({
      request,
      trustedUserId: "member_runtime_1",
    });
    await expect(response.json()).resolves.toEqual({
      dirty: [],
      schema: "murph.hosted-device-sync-dirty-state.v1",
    });
  });

  it("delegates dirty-ack POST with the original request and trusted user id", async () => {
    const request = jsonRequest({ requestId: "request_dirty_ack" });

    const response = await dirtyAckRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.ackHostedDeviceSyncDirtyStateProcessed).toHaveBeenCalledWith({
      request,
      trustedUserId: "member_runtime_1",
    });
    await expect(response.json()).resolves.toEqual({
      acked: true,
      schema: "murph.hosted-device-sync-dirty-ack.v1",
    });
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://join.example.test/api/internal/device-sync/runtime", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
