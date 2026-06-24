import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH } from "@murphai/hosted-execution/runtime-control";

const prismaMocks = vi.hoisted(() => ({
  createMany: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedProductFeedback: {
      createMany: prismaMocks.createMany,
    },
  }),
}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  normalizeHostedProductFeedback,
  recordHostedProductFeedback,
} from "@/src/lib/hosted-execution/product-feedback";

describe("recordHostedProductFeedback", () => {
  beforeEach(() => {
    prismaMocks.createMany.mockReset();
  });

  it("is idempotent per member and idempotency key", async () => {
    const insertedIds = new Set<string>();
    prismaMocks.createMany.mockImplementation(async (args: {
      data: Array<{ id: string }>;
    }) => {
      const id = args.data[0]?.id;
      if (!id || insertedIds.has(id)) {
        return { count: 0 };
      }
      insertedIds.add(id);
      return { count: 1 };
    });

    const feedback = makeFeedback({
      idempotencyKey: "a".repeat(64),
    });
    const first = await recordHostedProductFeedback({
      feedback,
      memberId: "member_123",
    });
    const second = await recordHostedProductFeedback({
      feedback,
      memberId: "member_123",
    });

    expect(first.feedbackId).toBe(second.feedbackId);
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(prismaMocks.createMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.createMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: [
        expect.objectContaining({
          memberId: "member_123",
          relatedChangelogItemIdsJson: ["native-message-formatting"],
          summary: "Interested in native message formatting.",
        }),
      ],
      skipDuplicates: true,
    }));
  });

  it("scopes duplicate keys by member", async () => {
    prismaMocks.createMany.mockResolvedValue({ count: 1 });
    const feedback = makeFeedback({
      idempotencyKey: "b".repeat(64),
    });

    const first = await recordHostedProductFeedback({
      feedback,
      memberId: "member_123",
    });
    const second = await recordHostedProductFeedback({
      feedback,
      memberId: "member_456",
    });

    expect(first.feedbackId).not.toBe(second.feedbackId);
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(true);
  });

  it("accepts feature requests without changelog ids", async () => {
    prismaMocks.createMany.mockResolvedValue({ count: 1 });

    const result = await recordHostedProductFeedback({
      feedback: makeFeedback({
        kind: "feature_request",
        relatedChangelogItemIds: [],
        summary: "Wants Strava integration support.",
      }),
      memberId: "member_123",
    });

    expect(result.recorded).toBe(true);
    expect(prismaMocks.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        expect.objectContaining({
          kind: "feature_request",
          relatedChangelogItemIdsJson: [],
          summary: "Wants Strava integration support.",
        }),
      ],
    }));
  });

  it.each([
    ["empty changelog ids for shipped interest", makeFeedback({ relatedChangelogItemIds: [] })],
    ["unknown changelog ids", makeFeedback({ relatedChangelogItemIds: ["not-a-real-item"] })],
    ["empty summary", makeFeedback({ summary: " \n\t " })],
    ["oversized summary", makeFeedback({ summary: "x".repeat(HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH + 1) })],
  ])("rejects %s before persistence", async (_label, feedback) => {
    await expect(recordHostedProductFeedback({
      feedback,
      memberId: "member_123",
    })).rejects.toMatchObject({
      code: "HOSTED_PRODUCT_FEEDBACK_REJECTED",
      httpStatus: 400,
    });
    expect(prismaMocks.createMany).not.toHaveBeenCalled();
  });
});

describe("normalizeHostedProductFeedback", () => {
  it("accepts canonical changelog feature interest", () => {
    expect(normalizeHostedProductFeedback(makeFeedback())).toEqual(makeFeedback());
  });

  it("normalizes bounded summary text", () => {
    expect(normalizeHostedProductFeedback(makeFeedback({
      summary: "  Wants   better message formatting.  ",
    })).summary).toBe("Wants better message formatting.");
  });

  it("throws the hosted onboarding error type for rejected content", () => {
    expect(() =>
      normalizeHostedProductFeedback(
        makeFeedback({ relatedChangelogItemIds: ["not-a-real-item"] }),
      ),
    ).toThrow(HostedOnboardingError);
  });
});

function makeFeedback(input: {
  idempotencyKey?: string;
  kind?: "feature_interest" | "feature_request" | "frustration";
  relatedChangelogItemIds?: string[];
  summary?: string;
} = {}) {
  return {
    idempotencyKey: input.idempotencyKey ?? "c".repeat(64),
    kind: input.kind ?? "feature_interest",
    relatedChangelogItemIds:
      input.relatedChangelogItemIds ?? ["native-message-formatting"],
    summary: input.summary ?? "Interested in native message formatting.",
  };
}
