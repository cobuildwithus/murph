import { createServer, type IncomingMessage, type Server } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedProductFeedback: {
      groupBy: mocks.groupBy,
    },
  }),
}));

import {
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

  it("sends only closed product-kind counts from the prior 6pm boundary", async () => {
    const readFeedback = vi.fn(async () => createFeedbackDigestBatch({
      feature_request: 2,
      frustration: 1,
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
        "- Feature requests: 2",
        "- Product frustrations: 1",
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

  it("aggregates only allowlisted product kinds without reading free-form text", async () => {
    mocks.groupBy.mockResolvedValue([
      {
        _count: { _all: 3 },
        kind: "feature_request",
        summary: "Private person and health detail that must remain stored only.",
      },
      {
        _count: { _all: 2 },
        kind: "frustration",
        summary: "Private conversation wording that must not enter email.",
      },
    ]);

    const batch = await readHostedProductFeedbackDigestBatch({
      endAt: new Date("2026-07-30T22:00:00.000Z"),
      startAt: new Date("2026-07-29T22:00:00.000Z"),
    });

    expect(batch).toEqual({
      counts: {
        feature_interest: 0,
        feature_request: 3,
        frustration: 2,
      },
    });
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ["kind"],
      _count: {
        _all: true,
      },
      where: {
        createdAt: {
          gte: new Date("2026-07-29T22:00:00.000Z"),
          lt: new Date("2026-07-30T22:00:00.000Z"),
        },
        kind: {
          in: ["feature_interest", "feature_request", "frustration"],
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
      text: "- Feature requests: 3\n- Product frustrations: 2",
    }));
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain("Private person");
    expect(JSON.stringify(sendEmail.mock.calls)).not.toContain(
      "Private conversation",
    );
  });

  it("retries the production transport with one day key after an ambiguous failure", async () => {
    mocks.groupBy.mockResolvedValue([
      {
        _count: { _all: 2 },
        kind: "feature_request",
        summary: "Private data must never be selected or sent.",
      },
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
        text: "- Feature requests: 2",
        to: ["product@example.test", "founder@example.test"],
      }),
      idempotencyKey: "hosted-product-feedback-digest/2026-07-30",
      method: "POST",
      path: "/emails",
    });
    expect(deliveryCount).toBe(1);
    expect(JSON.stringify(capturedRequests)).not.toContain("Private data");
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
    feature_interest: number;
    feature_request: number;
    frustration: number;
  }> = {},
) {
  return {
    counts: {
      feature_interest: overrides.feature_interest ?? 0,
      feature_request: overrides.feature_request ?? 0,
      frustration: overrides.frustration ?? 0,
    },
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
