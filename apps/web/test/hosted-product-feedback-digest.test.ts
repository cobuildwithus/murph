import { createServer, type IncomingMessage, type Server } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedProductFeedback: {
      findMany: mocks.findMany,
      groupBy: mocks.groupBy,
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
import {
  HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
  HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
} from "@/src/lib/hosted-execution/product-feedback";

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
    mocks.groupBy.mockReset();
  });

  it("does no work outside 6pm Eastern", async () => {
    const readFeedback = vi.fn(async () => createFeedbackDigestBatch());
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
      windowEndAt: null,
      windowStartAt: null,
    });
    expect(readFeedback).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends grouped kind summaries from the prior 6pm boundary", async () => {
    const readFeedback = vi.fn(async () => createFeedbackDigestBatch({
      feature_request: [
        "Wants a weekly training summary email.",
        "Asked for treadmill workout support.",
      ],
      frustration: ["Reminder cadence felt too frequent this week."],
    }));
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T22:00:30.000Z"),
      readFeedback,
      sendEmail,
    })).resolves.toMatchObject({
      dayKey: "2026-07-30",
      feedbackCount: 3,
      outcome: "sent",
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
        "Feature requests (2)",
        "- Wants a weekly training summary email.",
        "- Asked for treadmill workout support.",
        "",
        "Product frustrations (1)",
        "- Reminder cadence felt too frequent this week.",
      ].join("\n"),
      to: ["product@example.test", "founder@example.test"],
    });
  });

  it("fails missing configuration before reading and still sends an empty digest", async () => {
    const readFeedback = vi.fn(async () => createFeedbackDigestBatch());
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(runHostedProductFeedbackDigest({
      env: {
        ...feedbackDigestEnv,
        HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS: "",
      },
      now: new Date("2026-07-30T22:00:00.000Z"),
      readFeedback,
      sendEmail,
    })).rejects.toMatchObject({
      code: "HOSTED_PRODUCT_FEEDBACK_DIGEST_NOT_CONFIGURED",
      httpStatus: 503,
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

  it("reads only bounded allowlisted kind and summary columns", async () => {
    mocks.groupBy.mockResolvedValue([
      { _count: { _all: 2 }, kind: "feature_request" },
      { _count: { _all: 1 }, kind: "frustration" },
      { _count: { _all: 1 }, kind: "unrelated_kind" },
    ]);
    mocks.findMany.mockResolvedValue([
      { kind: "feature_request", summary: "Wants a weekly training summary email." },
      { kind: "frustration", summary: "Reminder cadence felt too frequent this week." },
      { kind: "feature_request", summary: "" },
      { kind: "unrelated_kind", summary: "Must never render." },
    ]);

    const batch = await readHostedProductFeedbackDigestBatch({
      endAt: new Date("2026-07-30T22:00:00.000Z"),
      startAt: new Date("2026-07-29T22:00:00.000Z"),
    });

    expect(batch).toEqual({
      counts: {
        feature_interest: 0,
        feature_request: 2,
        frustration: 1,
      },
      summariesByKind: {
        feature_interest: [],
        feature_request: ["Wants a weekly training summary email."],
        frustration: ["Reminder cadence felt too frequent this week."],
      },
    });
    const digestRowFilter = {
      createdAt: {
        gte: new Date("2026-07-29T22:00:00.000Z"),
        lt: new Date("2026-07-30T22:00:00.000Z"),
      },
      kind: {
        in: ["feature_interest", "feature_request", "frustration"],
      },
      NOT: {
        summary: {
          startsWith: "Support escalation:",
        },
      },
      summary: {
        not: null,
      },
    };
    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ["kind"],
      _count: {
        _all: true,
      },
      where: digestRowFilter,
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany).toHaveBeenCalledWith({
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        kind: true,
        summary: true,
      },
      take: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS,
      where: digestRowFilter,
    });
    const querySelect = mocks.findMany.mock.calls[0]?.[0]?.select;
    expect(Object.keys(querySelect)).toEqual(["kind", "summary"]);
    expect(querySelect).not.toHaveProperty("id");
    expect(querySelect).not.toHaveProperty("memberId");
    expect(querySelect).not.toHaveProperty("member");
    expect(querySelect).not.toHaveProperty("relatedChangelogItemIdsJson");

    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));
    await runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T22:00:30.000Z"),
      readFeedback: async () => batch,
      sendEmail,
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      text: [
        "Feature requests (2)",
        "- Wants a weekly training summary email.",
        "- (1 more not shown past the 200-item email limit)",
        "",
        "Product frustrations (1)",
        "- Reminder cadence felt too frequent this week.",
      ].join("\n"),
    }));
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain("Must never render");
  });

  it("sends only the anonymous written issue from a stored support pair", async () => {
    const memberId = "member_support_digest";
    const writtenIssue =
      "a relative named Rowan says their glucose sensor stopped syncing after a metformin change at the downtown clinic.";
    const storedRows = [
      {
        kind: "frustration",
        memberId,
        summary: HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
      },
      {
        kind: "frustration",
        memberId: null,
        summary: writtenIssue,
      },
    ];
    const digestRows = storedRows.filter(
      (row) => !row.summary.startsWith(HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX),
    );
    mocks.groupBy.mockResolvedValue([
      { _count: { _all: digestRows.length }, kind: "frustration" },
    ]);
    mocks.findMany.mockResolvedValue(digestRows.map(({ kind, summary }) => ({
      kind,
      summary,
    })));

    const batch = await readHostedProductFeedbackDigestBatch({
      endAt: new Date("2026-07-30T22:00:00.000Z"),
      startAt: new Date("2026-07-29T22:00:00.000Z"),
    });
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));
    await runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T22:00:30.000Z"),
      readFeedback: async () => batch,
      sendEmail,
    });

    expect(batch.counts.frustration).toBe(1);
    expect(batch.summariesByKind.frustration).toEqual([writtenIssue]);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      text: [
        "Product frustrations (1)",
        `- ${writtenIssue}`,
      ].join("\n"),
      to: ["product@example.test", "founder@example.test"],
    }));
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain(memberId);
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain(
      HOSTED_PRODUCT_SUPPORT_ESCALATION_RECORD_SUMMARY,
    );
    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        NOT: {
          summary: {
            startsWith: HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
          },
        },
      }),
    }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: {
        kind: true,
        summary: true,
      },
      where: expect.objectContaining({
        NOT: {
          summary: {
            startsWith: HOSTED_PRODUCT_SUPPORT_ESCALATION_PREFIX,
          },
        },
      }),
    }));
  });

  it("keeps per-kind counts truthful past the display cap", async () => {
    mocks.groupBy.mockResolvedValue([
      {
        _count: { _all: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS + 2 },
        kind: "feature_request",
      },
      { _count: { _all: 1 }, kind: "frustration" },
    ]);
    mocks.findMany.mockResolvedValue(Array.from(
      { length: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS },
      (_, index) => ({
        kind: "feature_request",
        summary: `Synthetic bounded product request ${index + 1}.`,
      }),
    ));

    const batch = await readHostedProductFeedbackDigestBatch({
      endAt: new Date("2026-07-30T22:00:00.000Z"),
      startAt: new Date("2026-07-29T22:00:00.000Z"),
    });

    expect(batch.summariesByKind.feature_request).toHaveLength(
      HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS,
    );

    const sendEmail = vi.fn(async (_input: { text: string }) => ({
      providerMessageId: "email_1",
    }));
    await expect(runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T22:00:30.000Z"),
      readFeedback: async () => batch,
      sendEmail,
    })).resolves.toMatchObject({
      feedbackCount: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS + 3,
    });

    const sentText = sendEmail.mock.calls[0]?.[0]?.text;
    expect(sentText).toContain(
      `Feature requests (${HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS + 2})`,
    );
    expect(sentText).toContain(
      `- (2 more not shown past the ${HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS}-item email limit)`,
    );
    expect(sentText).toContain("Product frustrations (1)");
    expect(sentText).toContain(
      `- (1 more not shown past the ${HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS}-item email limit)`,
    );
  });

  it("does not claim omission when every summary is displayed at the cap", async () => {
    const summaries = Array.from(
      { length: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS },
      (_, index) => `Synthetic bounded product request ${index + 1}.`,
    );
    const batch = createFeedbackDigestBatch({ feature_request: summaries });

    const sendEmail = vi.fn(async (_input: { text: string }) => ({
      providerMessageId: "email_1",
    }));
    await expect(runHostedProductFeedbackDigest({
      env: feedbackDigestEnv,
      now: new Date("2026-07-30T22:00:30.000Z"),
      readFeedback: async () => batch,
      sendEmail,
    })).resolves.toMatchObject({
      feedbackCount: HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS,
    });

    const sentText = sendEmail.mock.calls[0]?.[0]?.text;
    expect(sentText).toContain(
      `Feature requests (${HOSTED_PRODUCT_FEEDBACK_DIGEST_MAX_ROWS})`,
    );
    expect(sentText).not.toContain("more not shown");
  });

  it("retries the production transport with one day key after an ambiguous failure", async () => {
    mocks.groupBy.mockResolvedValue([
      { _count: { _all: 2 }, kind: "feature_request" },
    ]);
    mocks.findMany.mockResolvedValue([
      { kind: "feature_request", summary: "Wants a weekly training summary email." },
      { kind: "feature_request", summary: "Asked for treadmill workout support." },
    ]);
    const capturedRequests: CapturedResendRequest[] = [];
    const deliveredKeys = new Set<string>();
    let deliveryCount = 0;
    let requestCount = 0;
    const server = createServer((request, response) => {
      captureResendRequest(request).then((captured) => {
        capturedRequests.push(captured);
        requestCount += 1;

        if (!deliveredKeys.has(captured.idempotencyKey)) {
          deliveredKeys.add(captured.idempotencyKey);
          deliveryCount += 1;
        }

        if (requestCount === 1) {
          response.writeHead(503, { "content-type": "text/plain" });
          response.end("provider detail must stay private");
          return;
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "email_1" }));
      });
    });
    const apiBaseUrl = await listenOnLoopback(server);
    const env = {
      ...feedbackDigestEnv,
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      MURPH_HOSTED_LOCAL_RESEND_API_BASE_URL: apiBaseUrl,
    };

    try {
      await expect(runHostedProductFeedbackDigest({
        env,
        now: new Date("2026-07-30T22:00:30.000Z"),
      })).rejects.toMatchObject({
        code: "RESEND_SEND_FAILED",
        message: "Hosted Resend email send failed.",
        providerStatus: 503,
      });

      await expect(runHostedProductFeedbackDigest({
        env,
        now: new Date("2026-07-30T22:10:30.000Z"),
      })).resolves.toMatchObject({
        dayKey: "2026-07-30",
        feedbackCount: 2,
        outcome: "sent",
        windowEndAt: "2026-07-30T22:00:00.000Z",
        windowStartAt: "2026-07-29T22:00:00.000Z",
      });
    } finally {
      await closeTestServer(server);
    }

    expect(capturedRequests).toHaveLength(2);
    expect(capturedRequests[0]).toEqual(capturedRequests[1]);
    expect(capturedRequests[0]).toEqual({
      authorizationPresent: true,
      body: JSON.stringify({
        from: "Murph Alerts <alerts@example.test>",
        subject: "Murph feedback — 2026-07-30",
        text: [
          "Feature requests (2)",
          "- Wants a weekly training summary email.",
          "- Asked for treadmill workout support.",
        ].join("\n"),
        to: ["product@example.test", "founder@example.test"],
      }),
      idempotencyKey: "hosted-product-feedback-digest/2026-07-30",
      method: "POST",
      path: "/emails",
    });
    expect(deliveryCount).toBe(1);
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

type CapturedResendRequest = {
  authorizationPresent: boolean;
  body: string;
  idempotencyKey: string;
  method: string | undefined;
  path: string | undefined;
};

function createFeedbackDigestBatch(
  overrides: Partial<{
    feature_interest: string[];
    feature_request: string[];
    frustration: string[];
  }> = {},
  countOverrides: Partial<{
    feature_interest: number;
    feature_request: number;
    frustration: number;
  }> = {},
) {
  const summariesByKind = {
    feature_interest: overrides.feature_interest ?? [],
    feature_request: overrides.feature_request ?? [],
    frustration: overrides.frustration ?? [],
  };

  return {
    counts: {
      feature_interest:
        countOverrides.feature_interest ?? summariesByKind.feature_interest.length,
      feature_request:
        countOverrides.feature_request ?? summariesByKind.feature_request.length,
      frustration: countOverrides.frustration ?? summariesByKind.frustration.length,
    },
    summariesByKind,
  };
}

async function captureResendRequest(
  request: IncomingMessage,
): Promise<CapturedResendRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || !idempotencyKey) {
    throw new Error("Expected one Resend idempotency key.");
  }

  return {
    authorizationPresent: typeof request.headers.authorization === "string",
    body: Buffer.concat(chunks).toString("utf8"),
    idempotencyKey,
    method: request.method,
    path: request.url,
  };
}

async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a loopback TCP server address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeTestServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
