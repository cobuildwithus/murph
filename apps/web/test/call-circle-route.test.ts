import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimCallCircleNotificationDelivery: vi.fn(),
  handleCallCircleRespond: vi.fn(),
  prismaTransaction: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/notification-delivery", () => ({
  claimCallCircleNotificationDelivery: mocks.claimCallCircleNotificationDelivery,
}));

vi.mock("@/src/lib/call-circle/response-service", () => ({
  handleCallCircleRespond: mocks.handleCallCircleRespond,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: mocks.prismaTransaction,
  }),
}));

type CallCircleRouteModule =
  typeof import("../app/api/internal/call-circle/respond/route");
type CallCircleNotificationClaimRouteModule =
  typeof import("../app/api/internal/hosted-runtime/call-circle/notification-claim/route");

let callCircleRoute: CallCircleRouteModule;
let callCircleNotificationClaimRoute: CallCircleNotificationClaimRouteModule;

describe("Call Circle internal response route", () => {
  beforeAll(async () => {
    callCircleRoute = await import("../app/api/internal/call-circle/respond/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.handleCallCircleRespond.mockResolvedValue({ status: "ok" });
  });

  it("authenticates the raw Cloudflare callback body before handling the response", async () => {
    const payload = {
      request: { kind: "confirm" },
    };
    const rawBody = JSON.stringify(payload);
    const request = new Request("https://web.example.test/api/internal/call-circle/respond", {
      body: rawBody,
      method: "POST",
    });

    const response = await callCircleRoute.POST(request);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      {
        maxBodyBytes: 64 * 1024,
        payloadText: rawBody,
      },
    );
    expect(mocks.handleCallCircleRespond).toHaveBeenCalledWith({
      context: undefined,
      memberId: "member_123",
      request: payload.request,
    });
  });

  it("accepts the contextual response envelope for hosted reply context", async () => {
    const payload = {
      context: {
        inboundMailboxItemIds: ["mailbox_reply"],
        selfMemberName: "Sam",
      },
      request: {
        kind: "preferences",
        timeZone: "America/New_York",
        windows: [{
          dayOfWeek: 1,
          endLocalTime: "12:30",
          startLocalTime: "12:00",
        }],
      },
    };
    const rawBody = JSON.stringify(payload);
    const request = new Request("https://web.example.test/api/internal/call-circle/respond", {
      body: rawBody,
      method: "POST",
    });

    const response = await callCircleRoute.POST(request);

    expect(response.status).toBe(202);
    expect(mocks.handleCallCircleRespond).toHaveBeenCalledWith({
      context: payload.context,
      memberId: "member_123",
      request: payload.request,
    });
  });
});

describe("Call Circle notification-claim route", () => {
  beforeAll(async () => {
    callCircleNotificationClaimRoute = await import(
      "../app/api/internal/hosted-runtime/call-circle/notification-claim/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.prismaTransaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) => callback({}),
    );
    mocks.claimCallCircleNotificationDelivery.mockResolvedValue(undefined);
  });

  it("rejects notification claims without the runtime write fence", async () => {
    const request = createCallCircleNotificationClaimRequest();

    const response = await callCircleNotificationClaimRoute.POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CALL_CIRCLE_NOTIFICATION_WRITE_FENCE_REQUIRED",
      },
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.claimCallCircleNotificationDelivery).not.toHaveBeenCalled();
  });

  it("claims a notification only after the fenced callback is authenticated", async () => {
    const request = createCallCircleNotificationClaimRequest({
      "x-hosted-runtime-attempt-id": "attempt_current",
      "x-hosted-runtime-lease-generation": "5",
    });

    const response = await callCircleNotificationClaimRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      request,
      { maxBodyBytes: 8 * 1024 },
    );
    expect(mocks.claimCallCircleNotificationDelivery).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: {},
      request: {
        answeredMailboxItemIds: ["hmi_123"],
        deliveryIdempotencyKey:
          "assistant.notification.requested:call-circle:setup:hgrp_123:member_123",
      },
    });
  });
});

function createCallCircleNotificationClaimRequest(headers?: HeadersInit): Request {
  return new Request(
    "https://web.example.test/api/internal/hosted-runtime/call-circle/notification-claim",
    {
      body: JSON.stringify({
        answeredMailboxItemIds: ["hmi_123"],
        deliveryIdempotencyKey:
          "assistant.notification.requested:call-circle:setup:hgrp_123:member_123",
      }),
      headers,
      method: "POST",
    },
  );
}
