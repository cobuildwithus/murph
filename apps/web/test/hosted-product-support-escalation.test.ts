import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  count: vi.fn(),
  createMany: vi.fn(),
  executeRaw: vi.fn(),
  findFeedback: vi.fn(),
  findThreadContainer: vi.fn(),
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
  buildHostedProductSupportDetailFeedbackId,
  HOSTED_PRODUCT_SUPPORT_EMAIL,
  HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
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
    findUnique: typeof prismaMocks.findFeedback;
  };
  hostedThreadContainer: {
    findUnique: typeof prismaMocks.findThreadContainer;
  };
};

describe("hosted product support escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.executeRaw.mockResolvedValue(0);
    prismaMocks.findThreadContainer.mockResolvedValue(null);
    prismaMocks.transaction.mockImplementation(
      async (callback: (tx: TransactionClientMock) => Promise<unknown>) =>
        await callback({
          $executeRaw: prismaMocks.executeRaw,
          hostedProductFeedback: {
            count: prismaMocks.count,
            createMany: prismaMocks.createMany,
            findUnique: prismaMocks.findFeedback,
          },
          hostedThreadContainer: {
            findUnique: prismaMocks.findThreadContainer,
          },
        }),
    );
  });

  it("emails the first three member-linked escalations with a stable bounded payload", async () => {
    const feedback = makeSupportFeedback();
    const feedbackId = buildHostedProductFeedbackId({ feedback });
    const sendEmail = vi.fn().mockResolvedValue({
      providerMessageId: "email_123",
    });
    prismaMocks.createMany.mockResolvedValue({ count: 1 });
    prismaMocks.findFeedback.mockResolvedValue(makeStoredSupportFeedback({
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
    expect(prismaMocks.findThreadContainer).toHaveBeenCalledWith({
      select: { memberId: true },
      where: { memberId: MEMBER_ID },
    });
    expect(prismaMocks.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          createdAt: NOW,
          id: feedbackId,
          kind: "frustration",
          memberId: MEMBER_ID,
          relatedChangelogItemIdsJson: [],
          summary: HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
        }),
        expect.objectContaining({
          createdAt: NOW,
          id: buildHostedProductSupportDetailFeedbackId(feedbackId),
          kind: "frustration",
          memberId: null,
          relatedChangelogItemIdsJson: [],
          summary:
            "a connected source reports success but Murph does not finish the connection.",
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
    const emailText = sendEmail.mock.calls[0]?.[0].text ?? "";
    expect(emailText).toContain(`Feedback ID: ${feedbackId}`);
    expect(emailText).not.toContain(feedback.summary);
    expect(emailText).not.toContain("connected source");
  });

  it("keeps semantic private details out of the member-linked row and email", async () => {
    const semanticDetail =
      "Maria's diabetes readings from her Dexcom vanished after syncing at the Lakeside clinic.";
    const feedback = makeSupportFeedback({
      idempotencyKey: "9".repeat(64),
      detail: semanticDetail,
    });
    const feedbackId = buildHostedProductFeedbackId({ feedback });
    const sendEmail = vi.fn().mockResolvedValue({ providerMessageId: null });
    prismaMocks.createMany.mockResolvedValue({ count: 2 });
    prismaMocks.findFeedback.mockResolvedValue(makeStoredSupportFeedback({
      feedback,
      feedbackId,
    }));
    prismaMocks.count.mockResolvedValue(1);

    await recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback,
      memberId: MEMBER_ID,
      now: NOW,
      sendEmail,
    });

    const createManyRows = prismaMocks.createMany.mock.calls[0]?.[0]?.data ?? [];
    const memberRow = createManyRows.find(
      (row: { memberId: string | null }) => row.memberId !== null,
    );
    const anonymousRow = createManyRows.find(
      (row: { memberId: string | null }) => row.memberId === null,
    );
    expect(memberRow?.summary).toBe(
      HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
    );
    expect(memberRow?.summary).not.toContain("Maria");
    expect(anonymousRow?.summary).toBe(semanticDetail);
    expect(anonymousRow?.memberId).toBeNull();

    const emailText = sendEmail.mock.calls[0]?.[0].text ?? "";
    expect(emailText).not.toContain("Maria");
    expect(emailText).not.toContain("Dexcom");
    expect(emailText).not.toContain("diabetes");
    expect(emailText).toContain(`Member ID: ${MEMBER_ID}`);
  });

  it("records later escalations without sending more than three emails per UTC day", async () => {
    const feedback = makeSupportFeedback({
      idempotencyKey: "d".repeat(64),
    });
    const feedbackId = buildHostedProductFeedbackId({ feedback });
    const sendEmail = vi.fn();
    prismaMocks.createMany.mockResolvedValue({ count: 1 });
    prismaMocks.findFeedback.mockResolvedValue(makeStoredSupportFeedback({
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
    prismaMocks.findFeedback.mockResolvedValue(makeStoredSupportFeedback({
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

  it("fails closed before persistence for a synthetic group-room runtime", async () => {
    const sendEmail = vi.fn();
    prismaMocks.findThreadContainer.mockResolvedValue({ memberId: MEMBER_ID });

    await expect(recordHostedProductFeedback({
      env: EMAIL_ENV,
      feedback: makeSupportFeedback(),
      memberId: MEMBER_ID,
      now: NOW,
      sendEmail,
    })).rejects.toMatchObject({
      code: "HOSTED_PRODUCT_SUPPORT_PRIVATE_MEMBER_REQUIRED",
      httpStatus: 403,
    });

    expect(prismaMocks.createMany).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
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
    prismaMocks.findFeedback.mockResolvedValue({
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

  it("requires the exact support escalation prefix, content, and structured shape", () => {
    const feedback = makeSupportFeedback();
    expect(isHostedProductSupportEscalationSummary(feedback.summary)).toBe(true);
    expect(isHostedProductSupportEscalationFeedback(feedback)).toBe(true);
    expect(isHostedProductSupportEscalationSummary(
      HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
    )).toBe(false);
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
  detail?: string;
  idempotencyKey?: string;
} = {}) {
  return {
    idempotencyKey: input.idempotencyKey ?? "c".repeat(64),
    kind: "frustration" as const,
    relatedChangelogItemIds: [],
    summary: [
      HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
      input.detail
        ?? "a connected source reports success but Murph does not finish the connection.",
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
    summary: HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
  };
}
