import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runHostedProductFeedbackDigest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/product-feedback-digest", () => ({
  runHostedProductFeedbackDigest: mocks.runHostedProductFeedbackDigest,
}));

import { GET } from "@/app/api/internal/hosted-execution/product-feedback/digest/cron/route";

const originalCronSecret = process.env.CRON_SECRET;

describe("hosted product feedback digest cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "feedback-digest-cron-secret";
    mocks.runHostedProductFeedbackDigest.mockReset();
    mocks.runHostedProductFeedbackDigest.mockResolvedValue({
      dayKey: "2026-07-30",
      feedbackCount: 2,
      outcome: "sent",
      timeZone: "America/New_York",
      windowEndAt: "2026-07-30T22:00:00.000Z",
      windowStartAt: "2026-07-29T22:00:00.000Z",
    });
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it("runs the digest for an authenticated Vercel cron request", async () => {
    const response = await GET(new Request(
      "https://example.test/api/internal/hosted-execution/product-feedback/digest/cron",
      {
        headers: {
          authorization: "Bearer feedback-digest-cron-secret",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.runHostedProductFeedbackDigest).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects unauthenticated requests without reading feedback", async () => {
    const response = await GET(new Request(
      "https://example.test/api/internal/hosted-execution/product-feedback/digest/cron",
    ));

    expect(response.status).toBe(401);
    expect(mocks.runHostedProductFeedbackDigest).not.toHaveBeenCalled();
  });
});
