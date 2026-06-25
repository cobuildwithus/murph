import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordHostedProductFeedback: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
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
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
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
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ payloadText: expect.any(String) }),
    );
    expect(mocks.recordHostedProductFeedback).toHaveBeenCalledWith({
      feedback,
      memberId: "member_123",
    });
    await expect(response.json()).resolves.toEqual({
      feedbackId: "product_feedback_123",
      recorded: true,
    });
  });
});
