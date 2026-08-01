import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  count: vi.fn(),
  createMany: vi.fn(),
  executeRaw: vi.fn(),
  findUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: prismaMocks.transaction,
    hostedProductFeedback: {
      createMany: prismaMocks.createMany,
    },
  }),
}));

import {
  buildHostedProductFeedbackId,
  HOSTED_PRODUCT_SUPPORT_EMAIL,
  HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  HOSTED_PRODUCT_SUPPORT_EMAILS_PER_MEMBER_UTC_DAY_MAX,
  isHostedProductSupportEscalationFeedback,
  isHostedProductSupportEscalationSummary,
  recordHostedProductFeedback,
} from "@/src/lib/hosted-execution/product-feedback";

const NOW = new Date("2026-08-01T12:34:56.000Z");
const MEMBER_ID = "member_support_123";
const EMAIL_ENV = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph <support@withmurph.ai>",
  RESEND_API_KEY: "resend_test_key",
};

type TransactionClientMock = {
  $executeRaw: typeof prismaMocks.executeRaw;
  hostedProductFeedback: {
    count: typeof prismaMocks.count;
    createMany: typeof prismaMocks.createMany;
    findUnique: typeof prismaMocks.findUnique;
  };
};

describe("hosted product support escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.executeRaw.mockResolvedValue(0);
    prismaMocks.transaction.mockImplementation(
      async (callback: (tx: TransactionClientMock) => Promise<unknown>) =>
        await callback({
          $executeRaw: prismaMocks.executeRaw,
          hostedProductFeedback: {
            count: prismaMocks.count,
            createMany: prismaMocks.createMany,
            findUnique: prismaMocks.findUnique,
          },
        }),
    );
  });

  it("emails the first three member-linked escalations with a stable provider key", async () => {
    const feedback = makeSupportFeedback();
    const feedbackId = buildHostedProductFeedbackId({ feedback });
    const sendEmail = vi.fn().mockResolvedValue({
      providerMessageId: "email_123",
    });
    prismaMocks.createMany.mockResolvedValue({ count: 1 });
    prismaMocks.findUnique.mockResolvedValue(makeStoredSupportFeedback({
      feedback,
      feedbackId,
    }));
    prismaMocks.count.mockResolvedValue(
      HOSTED_PRODUCT_SUPPORT_EMAILS_PER_MEMBER_UTC_DAY_MAX,
    );

    const result = await recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback,
      memberId: MEMBER_ID,
      now: NOW,
      sendEmail,
    });

    expect(result).toEqual({
      feedbackId,
      recorded: true,
    });
    expect(prismaMocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMocks.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          createdAt: NOW,
          id: feedbackId,
          kind: "frustration",
          memberId: MEMBER_ID,
          relatedChangelogItemIdsJson: [],
          summary: feedback.summary,
        }),
      ],
      skipDuplicates: true,
    });
    expect(prismaMocks.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        createdAt: {
          gte: new Date("2026-08-01T00:00:00.000Z"),
          lt: new Date("2026-08-02T00:00:00.000Z"),
        },
        kind: "frustration",
        memberId: MEMBER_ID,
        summary: {
          startsWith: HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
        },
      }),
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `hosted-product-support/${feedbackId}`,
      subject: `Murph support escalation — ${feedbackId}`,
      text: expect.stringContaining(`Member ID: ${MEMBER_ID}`),
      to: [HOSTED_PRODUCT_SUPPORT_EMAIL],
    }));
    expect(sendEmail.mock.calls[0]?.[0].text).toContain(feedback.summary);
  });

  it("records later escalations without sending more than three emails per UTC day", async () => {
    const feedback = makeSupportFeedback({
      idempotencyKey: "d".repeat(64),
    });
    const feedbackId = buildHostedProductFeedbackId({ feedback });
    const sendEmail = vi.fn();
    prismaMocks.createMany.mockResolvedValue({ count: 1 });
    prismaMocks.findUnique.mockResolvedValue(makeStoredSupportFeedback({
      feedback,
      feedbackId,
    }));
    prismaMocks.count.mockResolvedValue(
      HOSTED_PRODUCT_SUPPORT_EMAILS_PER_MEMBER_UTC_DAY_MAX + 1,
    );

    await expect(recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback,
      memberId: MEMBER_ID,
      now: NOW,
      sendEmail,
    })).resolves.toEqual({
      feedbackId,
      recorded: true,
    });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("retries an eligible duplicate with the same Resend idempotency key", async () => {
    const feedback = makeSupportFeedback({
      idempotencyKey: "e".repeat(64),
    });
    const feedbackId = buildHostedProductFeedbackId({ feedback });
    const sendEmail = vi.fn().mockResolvedValue({ providerMessageId: null });
    prismaMocks.createMany.mockResolvedValue({ count: 0 });
    prismaMocks.findUnique.mockResolvedValue(makeStoredSupportFeedback({
      feedback,
      feedbackId,
    }));
    prismaMocks.count.mockResolvedValue(1);

    await expect(recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback,
      memberId: MEMBER_ID,
      now: NOW,
      sendEmail,
    })).resolves.toEqual({
      feedbackId,
      recorded: false,
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `hosted-product-support/${feedbackId}`,
    }));
  });

  it("fails closed when an escalation is not bound to an authenticated member", async () => {
    await expect(recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback: makeSupportFeedback(),
    })).rejects.toMatchObject({
      code: "HOSTED_PRODUCT_SUPPORT_MEMBER_REQUIRED",
      httpStatus: 400,
    });

    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a prefixed payload that is not the exact support shape", async () => {
    await expect(recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback: {
        ...makeSupportFeedback(),
        kind: "feature_request",
      },
      memberId: MEMBER_ID,
    })).rejects.toMatchObject({
      code: "HOSTED_PRODUCT_SUPPORT_REJECTED",
      httpStatus: 400,
    });

    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an idempotent replay bound to different support content", async () => {
    const feedback = makeSupportFeedback({
      idempotencyKey: "f".repeat(64),
    });
    const feedbackId = buildHostedProductFeedbackId({ feedback });
    prismaMocks.createMany.mockResolvedValue({ count: 0 });
    prismaMocks.findUnique.mockResolvedValue({
      ...makeStoredSupportFeedback({ feedback, feedbackId }),
      summary: `${HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX} a different issue.`,
    });

    await expect(recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback,
      memberId: MEMBER_ID,
      now: NOW,
    })).rejects.toMatchObject({
      code: "HOSTED_PRODUCT_SUPPORT_IDEMPOTENCY_CONFLICT",
      httpStatus: 409,
    });

    expect(prismaMocks.count).not.toHaveBeenCalled();
  });

  it("requires the exact support escalation prefix and structured shape", () => {
    const feedback = makeSupportFeedback();
    expect(isHostedProductSupportEscalationSummary(feedback.summary)).toBe(true);
    expect(isHostedProductSupportEscalationFeedback(feedback)).toBe(true);
    expect(isHostedProductSupportEscalationSummary(
      "support escalation: device connection failed.",
    )).toBe(false);
    expect(isHostedProductSupportEscalationFeedback({
      ...feedback,
      kind: "feature_request",
    })).toBe(false);
    expect(isHostedProductSupportEscalationFeedback({
      ...feedback,
      relatedChangelogItemIds: ["native-message-formatting"],
    })).toBe(false);
  });
});

function makeSupportFeedback(input: {
  idempotencyKey?: string;
} = {}) {
  return {
    idempotencyKey: input.idempotencyKey ?? "c".repeat(64),
    kind: "frustration" as const,
    relatedChangelogItemIds: [],
    summary: [
      HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
      "a connected source reports success but Murph does not finish the connection.",
    ].join(" "),
  };
}

function makeStoredSupportFeedback(input: {
  feedback: ReturnType<typeof makeSupportFeedback>;
  feedbackId: string;
}) {
  return {
    createdAt: NOW,
    id: input.feedbackId,
    kind: input.feedback.kind,
    memberId: MEMBER_ID,
    relatedChangelogItemIdsJson: [],
    summary: input.feedback.summary,
  };
}
