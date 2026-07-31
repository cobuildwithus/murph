import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostedRuntimeProductFeedbackRecord,
} from "@murphai/hosted-execution/runtime-control";

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
  formatHostedProductFeedbackSummary,
  normalizeHostedProductFeedback,
  recordHostedProductFeedback,
} from "@/src/lib/hosted-execution/product-feedback";

describe("recordHostedProductFeedback", () => {
  beforeEach(() => {
    prismaMocks.createMany.mockReset();
  });

  it("stores only a closed anonymous abstraction and is idempotent by runtime key", async () => {
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

    const feedback = makeFeedback({ idempotencyKey: "a".repeat(64) });
    const first = await recordHostedProductFeedback({ feedback });
    const second = await recordHostedProductFeedback({ feedback });

    expect(first.feedbackId).toBe(second.feedbackId);
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(prismaMocks.createMany).toHaveBeenNthCalledWith(1, {
      data: [{
        id: first.feedbackId,
        kind: "feature_interest",
        memberId: null,
        relatedChangelogItemIdsJson: ["native-message-formatting"],
        summary: "product_area=messaging; action=view; outcome=interest",
      }],
      skipDuplicates: true,
    });
  });

  it("does not encode an optional member link into the feedback id", async () => {
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
    const feedback = makeFeedback({ idempotencyKey: "b".repeat(64) });

    const first = await recordHostedProductFeedback({ feedback });
    const second = await recordHostedProductFeedback({
      feedback,
      memberId: "member_explicitly_linked",
    });

    expect(first.feedbackId).toBe(second.feedbackId);
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(prismaMocks.createMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: [expect.objectContaining({ memberId: null })],
      }),
    );
    expect(prismaMocks.createMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: [expect.objectContaining({ memberId: "member_explicitly_linked" })],
      }),
    );
  });

  it("persists a useful closed classification without changelog ids", async () => {
    prismaMocks.createMany.mockResolvedValue({ count: 1 });

    await recordHostedProductFeedback({
      feedback: makeFeedback({
        action: "configure",
        kind: "feature_request",
        outcome: "capability_missing",
        productArea: "experiments_and_challenges",
        relatedChangelogItemIds: [],
      }),
    });

    expect(prismaMocks.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        kind: "feature_request",
        relatedChangelogItemIdsJson: [],
        summary:
          "product_area=experiments_and_challenges; action=configure; outcome=capability_missing",
      })],
    }));
  });

  it("rejects unknown changelog ids before persistence", async () => {
    await expect(recordHostedProductFeedback({
      feedback: makeFeedback({ relatedChangelogItemIds: ["not-a-real-item"] }),
    })).rejects.toMatchObject({
      code: "HOSTED_PRODUCT_FEEDBACK_REJECTED",
      httpStatus: 400,
    });
    expect(prismaMocks.createMany).not.toHaveBeenCalled();
  });
});

describe("normalizeHostedProductFeedback", () => {
  it("accepts only canonical enum fields and published changelog ids", () => {
    const canonical = makeFeedback();
    expect(normalizeHostedProductFeedback(canonical)).toEqual(canonical);

    const published = makeFeedback({
      productArea: "assistant",
      relatedChangelogItemIds: ["ask-grok-x-research"],
    });
    expect(normalizeHostedProductFeedback(published)).toEqual(published);
  });

  it("rejects arbitrary extra prose and constructs summaries from enums only", () => {
    const candidate = {
      ...makeFeedback({
        action: "sync",
        kind: "frustration",
        outcome: "failed",
        productArea: "device_sync",
        relatedChangelogItemIds: [],
      }),
      summary:
        "A name, diagnosis, medication dose, reproductive detail, location, relationship, exact value, and quotation.",
    };

    expect(() => normalizeHostedProductFeedback(candidate)).toThrow(
      HostedOnboardingError,
    );
    expect(formatHostedProductFeedbackSummary(makeFeedback({
      action: "sync",
      kind: "frustration",
      outcome: "failed",
      productArea: "device_sync",
      relatedChangelogItemIds: [],
    }))).toBe(
      "product_area=device_sync; action=sync; outcome=failed",
    );
  });

  it("throws the hosted onboarding error type for rejected changelog metadata", () => {
    expect(() => normalizeHostedProductFeedback(
      makeFeedback({ relatedChangelogItemIds: ["not-a-real-item"] }),
    )).toThrow(HostedOnboardingError);
  });
});

function makeFeedback(
  input: Partial<HostedRuntimeProductFeedbackRecord> = {},
): HostedRuntimeProductFeedbackRecord {
  return {
    action: input.action ?? "view",
    idempotencyKey: input.idempotencyKey ?? "c".repeat(64),
    kind: input.kind ?? "feature_interest",
    outcome: input.outcome ?? "interest",
    productArea: input.productArea ?? "messaging",
    relatedChangelogItemIds:
      input.relatedChangelogItemIds ?? ["native-message-formatting"],
  };
}
