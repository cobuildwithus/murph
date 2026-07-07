import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleCallCircleRespond: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/response-service", () => ({
  handleCallCircleRespond: mocks.handleCallCircleRespond,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

type CallCircleRouteModule =
  typeof import("../app/api/internal/call-circle/respond/route");

let callCircleRoute: CallCircleRouteModule;

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
      groupId: "hgrp_123",
      kind: "confirm",
      matchId: "hccm_123",
      side: "A",
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
      request: payload,
    });
  });

  it("accepts the contextual response envelope for hosted reply context", async () => {
    const payload = {
      context: {
        inboundMailboxItemIds: ["mailbox_reply"],
      },
      request: {
        kind: "preferences",
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
