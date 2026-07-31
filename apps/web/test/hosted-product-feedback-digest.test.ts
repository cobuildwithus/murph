import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedProductFeedback: {
      findMany: mocks.findMany,
    },
  }),
}));

import {
  HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS,
  HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
  readHostedProductFeedbackDigestBatch,
  resolveHostedProductFeedbackDigestWindow,
  runHostedProductFeedbackDigest,
} from "@/src/lib/hosted-execution/product-feedback-digest";

const feedbackDigestEnv = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "ops@example.test",
  HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS:
    "product@example.test, founder@example.test",
  RESEND_API_KEY: "re_test",
};

describe("hosted product feedback digest", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
  });

  it("does no work outside 6pm Eastern", async () => {
    const readFeedback = vi.fn(async () => ({
      summaries: [],
      truncated: false,
    }));
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T21:00:00.000Z"),
      readFeedback,
      sendEmail,
    })).resolves.toEqual({
      dayKey: "2026-07-30",
      feedbackCount: 0,
      outcome: "outside_send_hour",
      timeZone: HOSTED_PRODUCT_FEEDBACK_DIGEST_TIME_ZONE,
      truncated: false,
      windowEndAt: null,
      windowStartAt: null,
    });
    expect(readFeedback).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends sanitized product-only summaries from the prior 6pm boundary", async () => {
    const readFeedback = vi.fn(async () => ({
      summaries: [
        "Feature request summary.",
        "Product-friction summary.",
      ],
      truncated: false,
    }));
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T22:00:30.000Z"),
      readFeedback,
      sendEmail,
    })).resolves.toMatchObject({
      dayKey: "2026-07-30",
      feedbackCount: 2,
      outcome: "sent",
      truncated: false,
      windowEndAt: "2026-07-30T22:00:00.000Z",
      windowStartAt: "2026-07-29T22:00:00.000Z",
    });

    expect(readFeedback).toHaveBeenCalledWith({
      endAt: new Date("2026-07-30T22:00:00.000Z"),
      startAt: new Date("2026-07-29T22:00:00.000Z"),
    });
    expect(sendEmail).toHaveBeenCalledWith({
      config: {
        apiKey: "re_test",
        from: "Murph Alerts <alerts@example.test>",
        timeoutMs: 10_000,
      },
      idempotencyKey: "hosted-product-feedback-digest/2026-07-30",
      subject: "Murph feedback — 2026-07-30",
      text: [
        "- Feature request summary.",
        "- Product-friction summary.",
      ].join("\n"),
      to: ["product@example.test", "founder@example.test"],
    });
  });

  it("uses a dedicated recipient env and still sends an empty daily digest", async () => {
    const readFeedback = vi.fn(async () => ({
      summaries: [],
      truncated: false,
    }));
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(runHostedProductFeedbackDigest({
      env: {
        ...feedbackDigestEnv,
        HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS: "",
      },
      now: new Date("2026-07-30T22:00:00.000Z"),
      readFeedback,
      sendEmail,
    })).resolves.toMatchObject({
      outcome: "not_configured",
    });
    expect(readFeedback).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();

    await runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-01-15T23:00:00.000Z"),
      readFeedback,
      sendEmail,
    });
    expect(sendEmail).toHaveBeenLastCalledWith(expect.objectContaining({
      text: "- No feedback logged.",
    }));
  });

  it("bounds the database read and makes overflow visible in the email", async () => {
    mocks.findMany.mockResolvedValue(Array.from(
      { length: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS + 1 },
      (_, index) => ({ summary: `Summary ${index + 1}` }),
    ));

    const batch = await readHostedProductFeedbackDigestBatch({
      endAt: new Date("2026-07-30T22:00:00.000Z"),
      startAt: new Date("2026-07-29T22:00:00.000Z"),
    });

    expect(batch).toMatchObject({
      truncated: true,
    });
    expect(batch.summaries).toHaveLength(
      HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS,
    );
    expect(mocks.findMany).toHaveBeenCalledWith({
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        summary: true,
      },
      take: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS + 1,
      where: {
        createdAt: {
          gte: new Date("2026-07-29T22:00:00.000Z"),
          lt: new Date("2026-07-30T22:00:00.000Z"),
        },
        summary: {
          not: null,
        },
      },
    });

    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));
    await runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T22:00:30.000Z"),
      readFeedback: async () => batch,
      sendEmail,
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining(
        `Additional feedback omitted from this email after the ${HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS}-item safety limit.`,
      ),
    }));
  });

  it.each([
    {
      endAt: "2026-03-08T22:00:00.000Z",
      name: "spring-forward",
      now: "2026-03-08T22:00:30.000Z",
      startAt: "2026-03-07T23:00:00.000Z",
    },
    {
      endAt: "2026-11-01T23:00:00.000Z",
      name: "fall-back",
      now: "2026-11-01T23:00:30.000Z",
      startAt: "2026-10-31T22:00:00.000Z",
    },
  ])("keeps the 6pm boundaries through $name", ({ endAt, now, startAt }) => {
    const window = resolveHostedProductFeedbackDigestWindow(new Date(now));

    expect(window.endAt.toISOString()).toBe(endAt);
    expect(window.startAt.toISOString()).toBe(startAt);
  });
});
