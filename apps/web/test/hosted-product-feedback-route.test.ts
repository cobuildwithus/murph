import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordHostedProductFeedback: vi.fn(),
  requireHostedCloudflareCallbackJsonRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest:
    mocks.requireHostedCloudflareCallbackJsonRequest,
}));

vi.mock("@/src/lib/hosted-execution/product-feedback", () => ({
  recordHostedProductFeedback: mocks.recordHostedProductFeedback,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/product-feedback/record/route"
);

let route: RouteModule;

describe("hosted product feedback record route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/product-feedback/record/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackJsonRequest.mockImplementation(
      async (request: Request) => ({
        payload: await request.json(),
        userId: "member_123",
      }),
    );
    mocks.recordHostedProductFeedback.mockResolvedValue({
      feedbackId: "product_feedback_123",
      recorded: true,
    });
  });

  it("authenticates the callback and records bounded feedback", async () => {
    const feedback = {
      idempotencyKey: "a".repeat(64),
      kind: "feature_interest",
      relatedChangelogItemIds: [],
      summary: "Interested in generated song reminders.",
    };
    const response = await route.POST(
      new Request(
        "https://join.example.test/api/internal/hosted-execution/product-feedback/record",
        {
          body: JSON.stringify({ feedback }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackJsonRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 16_384 },
    );
    expect(mocks.recordHostedProductFeedback).toHaveBeenCalledWith({
      feedback,
    });
    await expect(response.json()).resolves.toEqual({
      feedbackId: "product_feedback_123",
      recorded: true,
    });
  });
});
