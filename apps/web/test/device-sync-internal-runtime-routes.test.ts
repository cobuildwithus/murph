import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_BYTES_HEADER as bytesHeader } from "@murphai/device-syncd/hosted-runtime";
import { jsonOk } from "@/src/lib/device-sync/settings-http";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  ackHostedDeviceSyncDirtyStateProcessed: vi.fn(),
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  disconnectOwnedConnection: vi.fn(),
  isHostedThreadContainerMember: vi.fn(),
  readHostedDeviceSyncPendingDirtyState: vi.fn(),
  readHostedDeviceSyncRuntimeState: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
  requireHostedCloudflareCallbackJsonRequest: mocks.requireHostedCloudflareCallbackJsonRequest,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService: () => ({ disconnectOwnedConnection: mocks.disconnectOwnedConnection }),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/member-access")>(),
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
  isHostedThreadContainerMember: mocks.isHostedThreadContainerMember,
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
let disconnectRoute: typeof import("../app/api/internal/device-sync/disconnect/route");

describe("device-sync internal runtime routes", () => {
  beforeAll(async () => {
    snapshotRoute = await import("../app/api/internal/device-sync/runtime/snapshot/route");
    dirtyPendingRoute = await import(
      "../app/api/internal/device-sync/runtime/dirty-pending/route"
    );
    dirtyAckRoute = await import("../app/api/internal/device-sync/runtime/dirty-ack/route");
    disconnectRoute = await import("../app/api/internal/device-sync/disconnect/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockResolvedValue({
      payload: { connectionId: "account_sam" }, userId: "member_runtime_1",
    });
    mocks.isHostedThreadContainerMember.mockResolvedValue(false);
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
    expect(response.headers.has(bytesHeader)).toBe(false);
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
      expect(response.headers.has(bytesHeader)).toBe(false);
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

  it("serializes once with the same jsonOk semantics, ignores request markers and supports old JSON readers", async () => {
    const payload = { connections: [], generatedAt: "2026-09-08T16:00:00.000Z", userId: "synthetic-雪-🧪" };
    const toJSON = vi.fn(() => payload);
    mocks.readHostedDeviceSyncRuntimeState.mockResolvedValueOnce({ toJSON });
    const request = jsonRequest({ requestId: "synthetic_request" });
    request.headers.set(bytesHeader, "1");
    const clone = vi.spyOn(Response.prototype, "clone");
    const response = await snapshotRoute.POST(request);
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request, {
      maxBodyBytes: 256 * 1024,
    });
    const legacyResponse = jsonOk(payload);
    expect(response.status).toBe(legacyResponse.status);
    const headers = new Headers(response.headers);
    headers.delete(bytesHeader);
    expect([...headers]).toEqual([...legacyResponse.headers]);
    expect(response.headers.get(bytesHeader)).toBe(String(new TextEncoder().encode(JSON.stringify(payload)).byteLength));
    // An old consumer reads exactly the same JSON and need not know the marker.
    await expect(response.json()).resolves.toEqual(await legacyResponse.json());
    clone.mockRestore();
  });

  it("never marks an authorized snapshot producer failure as successful output", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readHostedDeviceSyncRuntimeState.mockRejectedValueOnce(new Error("Synthetic read failure"));
    const response = await snapshotRoute.POST(jsonRequest({}));
    expect(response.status).toBe(500);
    expect(response.headers.has(bytesHeader)).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    error.mockRestore();
  });

  it("delegates dirty-pending POST with the original request and trusted user id", async () => {
    const request = jsonRequest({ requestId: "request_dirty_pending" });

    const response = await dirtyPendingRoute.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has(bytesHeader)).toBe(false);
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
    expect(response.headers.has(bytesHeader)).toBe(false);
    expect(mocks.ackHostedDeviceSyncDirtyStateProcessed).toHaveBeenCalledWith({
      request,
      trustedUserId: "member_runtime_1",
    });
    await expect(response.json()).resolves.toEqual({
      acked: true,
      schema: "murph.hosted-device-sync-dirty-ack.v1",
    });
  });

  it.each([
    [{ connection: { status: "disconnected" } }, "disconnected"],
    [{ connection: { status: "disconnected" }, alreadyDisconnected: true }, "already_disconnected"],
    [{ connection: { status: "reauthorization_required" } }, "not_finished"],
  ] as const)("delegates the exact wearable to the signed member and reports %s", async (result, status) => {
    mocks.disconnectOwnedConnection.mockResolvedValueOnce(result);
    const response = await disconnectRoute.POST(jsonRequest({ connectionId: "account_sam" }));
    expect(response.status).toBe(200);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({ memberId: "member_runtime_1" });
    expect(mocks.disconnectOwnedConnection).toHaveBeenCalledWith("member_runtime_1", "account_sam");
    await expect(response.json()).resolves.toEqual({ status });
  });

  it("rejects a wearable disconnect from a group container", async () => {
    mocks.isHostedThreadContainerMember.mockResolvedValueOnce(true);
    const response = await disconnectRoute.POST(jsonRequest({ connectionId: "account_sam" }));
    expect(response.status).toBe(403);
    expect(mocks.disconnectOwnedConnection).not.toHaveBeenCalled();
  });

  it("rejects a wearable disconnect with an actor in the request body", async () => {
    mocks.requireHostedCloudflareCallbackJsonRequest.mockResolvedValueOnce({
      payload: { connectionId: "account_sam", memberId: "member_other" }, userId: "member_runtime_1",
    });
    const response = await disconnectRoute.POST(jsonRequest({}));
    expect(response.status).toBe(400);
    expect(mocks.disconnectOwnedConnection).not.toHaveBeenCalled();
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
