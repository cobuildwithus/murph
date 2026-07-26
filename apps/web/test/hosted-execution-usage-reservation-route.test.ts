import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markHostedAiUsageReservationDispatched: vi.fn(),
  releaseHostedAiUsageReservation: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
  reserveHostedImageGenerationCapacity: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  markHostedAiUsageReservationDispatched:
    mocks.markHostedAiUsageReservationDispatched,
  releaseHostedAiUsageReservation: mocks.releaseHostedAiUsageReservation,
  reserveHostedImageGenerationCapacity:
    mocks.reserveHostedImageGenerationCapacity,
}));

type HostedExecutionUsageReservationRouteModule = typeof import(
  "../app/api/internal/hosted-execution/usage/reservation/route"
);

let hostedExecutionUsageReservationRoute:
  HostedExecutionUsageReservationRouteModule;

const IMAGE_ESTIMATE = {
  model: "gpt-image-2",
  promptUtf8Bytes: 84,
  quality: "medium",
  referenceImageCount: 2,
  size: "1024x1536",
} as const;
const IMAGE_USAGE_ID = "turn_image_123.attempt-1";

describe("hosted execution usage reservation route", () => {
  beforeAll(async () => {
    hostedExecutionUsageReservationRoute = await import(
      "../app/api/internal/hosted-execution/usage/reservation/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request) => ({
        payload: await request.json(),
        userId: "member_from_callback_auth",
      }),
    );
    mocks.reserveHostedImageGenerationCapacity.mockResolvedValue({
      requestId: IMAGE_USAGE_ID,
      status: "reserved",
    });
    mocks.markHostedAiUsageReservationDispatched.mockResolvedValue({
      requestId: "image_request_123",
      status: "dispatched",
    });
    mocks.releaseHostedAiUsageReservation.mockResolvedValue({
      requestId: "image_request_123",
      status: "released",
    });
  });

  it("reserves image capacity for the callback-authenticated member", async () => {
    const response = await postReservation({
      action: "reserve_image",
      estimate: IMAGE_ESTIMATE,
      requestId: IMAGE_USAGE_ID,
    });

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 2_048 },
    );
    expect(mocks.reserveHostedImageGenerationCapacity)
      .toHaveBeenCalledExactlyOnceWith({
        memberId: "member_from_callback_auth",
        requestId: IMAGE_USAGE_ID,
        spec: IMAGE_ESTIMATE,
      });
    await expect(response.json()).resolves.toEqual({
      action: "reserve_image",
      requestId: IMAGE_USAGE_ID,
      status: "reserved",
    });
  });

  it("marks the authenticated member's reservation dispatched", async () => {
    const response = await postReservation({
      action: "mark_dispatched",
      requestId: "image_request_123",
    });

    expect(response.status).toBe(200);
    expect(mocks.markHostedAiUsageReservationDispatched)
      .toHaveBeenCalledExactlyOnceWith({
        memberId: "member_from_callback_auth",
        requestId: "image_request_123",
      });
    await expect(response.json()).resolves.toEqual({
      action: "mark_dispatched",
      requestId: "image_request_123",
      status: "dispatched",
    });
  });

  it("releases the authenticated member's reservation", async () => {
    const response = await postReservation({
      action: "release",
      requestId: "image_request_123",
    });

    expect(response.status).toBe(200);
    expect(mocks.releaseHostedAiUsageReservation)
      .toHaveBeenCalledExactlyOnceWith({
        memberId: "member_from_callback_auth",
        requestId: "image_request_123",
      });
    await expect(response.json()).resolves.toEqual({
      action: "release",
      requestId: "image_request_123",
      status: "released",
    });
  });

  it.each([
    [
      "an untrimmed request id",
      {
        action: "release",
        requestId: " image_request_123",
      },
    ],
    [
      "an unsupported action",
      {
        action: "inspect",
        requestId: "image_request_123",
      },
    ],
    [
      "an extra field",
      {
        action: "release",
        reason: "private_extra_value",
        requestId: "image_request_123",
      },
    ],
    [
      "payload-supplied member authority",
      {
        action: "release",
        memberId: "member_payload_private",
        requestId: "image_request_123",
      },
    ],
    [
      "private prompt content instead of bounded image metadata",
      {
        action: "reserve_image",
        estimate: {
          ...IMAGE_ESTIMATE,
          prompt: "private_prompt_value",
        },
        requestId: IMAGE_USAGE_ID,
      },
    ],
  ])("rejects %s before touching reservation state", async (_label, body) => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await postReservation(body);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request.",
        },
      });
      expect(mocks.reserveHostedImageGenerationCapacity).not.toHaveBeenCalled();
      expect(mocks.markHostedAiUsageReservationDispatched).not.toHaveBeenCalled();
      expect(mocks.releaseHostedAiUsageReservation).not.toHaveBeenCalled();
      const logged = JSON.stringify(consoleWarn.mock.calls);
      expect(logged).not.toContain("member_payload_private");
      expect(logged).not.toContain("private_extra_value");
      expect(logged).not.toContain("private_prompt_value");
    } finally {
      consoleWarn.mockRestore();
    }
  });
});

function postReservation(body: Record<string, unknown>): Promise<Response> {
  return hostedExecutionUsageReservationRoute.POST(
    new Request(
      "https://join.example.test/api/internal/hosted-execution/usage/reservation",
      {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
    ),
  );
}
