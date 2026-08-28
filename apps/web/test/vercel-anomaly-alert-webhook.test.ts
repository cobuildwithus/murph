import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { HostedResendPlainTextEmailError } from "@/src/lib/hosted-onboarding/resend-plain-text-email";
import {
  handleHostedVercelAnomalyWebhook,
} from "@/src/lib/hosted-operational-alert/vercel-anomaly-webhook";

const WEBHOOK_SECRET = "vercel-alert-webhook-secret";
const ALERT_ENV = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.com>",
  HOSTED_LINQ_ALERT_EMAILS: "operator@example.com",
  HOSTED_WEB_VERCEL_ALERT_WEBHOOK_SECRET: WEBHOOK_SECRET,
  RESEND_API_KEY: "re_test",
};

type VercelAlertEmailSend = NonNullable<
  Parameters<typeof handleHostedVercelAnomalyWebhook>[0]["sendEmail"]
>;

function createSendEmailMock() {
  return vi.fn<VercelAlertEmailSend>(async () => ({
    providerMessageId: "email_123",
  }));
}

describe("hosted Vercel anomaly alert webhook", () => {
  it("sends one aggregate-only alert with stable replay identity", async () => {
    const sendEmail = createSendEmailMock();
    const rawBody = JSON.stringify(buildAlertEvent({
      payload: {
        alerts: [
          buildAlert({
            count: 10_240,
            title: "Function invocation usage anomaly",
          }),
          buildAlert({
            alertId: "alrt_second",
            metric: "function_errors",
            title: "Function error anomaly",
            type: "error_anomaly",
          }),
        ],
        formattedValues: {
          rawMemberEmail: "private@example.test",
        },
        groupId: "group_private_123",
        links: {
          observability:
            "https://vercel.com/acme/murph-web/observability?token=private_token#private_fragment",
        },
        projectId: "project_private_123",
        teamId: "team_private_123",
      },
    }));
    const input = {
      env: ALERT_ENV,
      rawBody,
      sendEmail,
      signature: sign(rawBody),
    };

    await expect(handleHostedVercelAnomalyWebhook(input)).resolves.toEqual({
      alertCount: 2,
      ok: true,
      outcome: "sent",
    });
    await handleHostedVercelAnomalyWebhook(input);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const firstSend = sendEmail.mock.calls[0]?.[0];
    expect(sendEmail.mock.calls[1]?.[0]).toEqual(firstSend);
    expect(firstSend).toMatchObject({
      idempotencyKey: expect.stringMatching(/^murph\/vercel-alert\/[a-f0-9]{64}$/u),
      subject: "Vercel anomaly detected",
      to: ["operator@example.com"],
    });
    expect(firstSend?.text).toContain("Project: murph-web");
    expect(firstSend?.text).toContain("Observed: 10,240 requests");
    expect(firstSend?.text).toContain("Z-score: 8.5");
    expect(firstSend?.text).toContain("Alert count: 2");
    expect(firstSend?.text).toContain(
      "Open in Vercel: https://vercel.com/acme/murph-web/observability",
    );
    expect(firstSend?.text).not.toContain("evt_vercel_alert_123");
    expect(firstSend?.text).not.toContain("project_private_123");
    expect(firstSend?.text).not.toContain("team_private_123");
    expect(firstSend?.text).not.toContain("group_private_123");
    expect(firstSend?.text).not.toContain("private@example.test");
    expect(firstSend?.text).not.toContain("private_token");
    expect(firstSend?.text).not.toContain("private_fragment");
  });

  it("verifies the exact raw body before parsing or sending", async () => {
    const sendEmail = createSendEmailMock();
    const rawBody = JSON.stringify(buildAlertEvent());

    await expect(handleHostedVercelAnomalyWebhook({
      env: ALERT_ENV,
      rawBody: `${rawBody} `,
      sendEmail,
      signature: sign(rawBody),
    })).rejects.toMatchObject({
      code: "HOSTED_VERCEL_ALERT_WEBHOOK_UNAUTHORIZED",
      httpStatus: 401,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "",
    "not-a-signature",
    "a".repeat(39),
    "z".repeat(40),
  ])("rejects an invalid signature %j before sending", async (signature) => {
    const sendEmail = createSendEmailMock();
    const rawBody = JSON.stringify(buildAlertEvent());

    await expect(handleHostedVercelAnomalyWebhook({
      env: ALERT_ENV,
      rawBody,
      sendEmail,
      signature,
    })).rejects.toMatchObject({
      code: "HOSTED_VERCEL_ALERT_WEBHOOK_UNAUTHORIZED",
      httpStatus: 401,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the webhook secret is unavailable", async () => {
    const sendEmail = createSendEmailMock();

    await expect(handleHostedVercelAnomalyWebhook({
      env: {
        ...ALERT_ENV,
        HOSTED_WEB_VERCEL_ALERT_WEBHOOK_SECRET: undefined,
      },
      rawBody: "{}",
      sendEmail,
      signature: "a".repeat(40),
    })).rejects.toMatchObject({
      code: "HOSTED_VERCEL_ALERT_WEBHOOK_NOT_CONFIGURED",
      httpStatus: 503,
      retryable: true,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("acknowledges an unsupported signed event without requiring email config", async () => {
    const sendEmail = createSendEmailMock();
    const rawBody = JSON.stringify({
      id: "evt_other_123",
      type: "deployment.succeeded",
    });

    await expect(handleHostedVercelAnomalyWebhook({
      env: {
        HOSTED_WEB_VERCEL_ALERT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      },
      rawBody,
      sendEmail,
      signature: sign(rawBody),
    })).resolves.toEqual({
      ok: true,
      outcome: "ignored_event",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "invalid JSON",
      rawBody: "{",
    },
    {
      label: "missing alerts",
      rawBody: JSON.stringify(buildAlertEvent({
        payload: {
          alerts: [],
        },
      })),
    },
    {
      label: "non-finite aggregate",
      rawBody: JSON.stringify(buildAlertEvent({
        payload: {
          alerts: [buildAlert({ average: "many" })],
        },
      })),
    },
  ])("rejects $label before sending", async ({ rawBody }) => {
    const sendEmail = createSendEmailMock();

    await expect(handleHostedVercelAnomalyWebhook({
      env: ALERT_ENV,
      rawBody,
      sendEmail,
      signature: sign(rawBody),
    })).rejects.toMatchObject({
      code: "HOSTED_VERCEL_ALERT_WEBHOOK_PAYLOAD_INVALID",
      httpStatus: 400,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("normalizes provider display text and omits an untrusted observability URL", async () => {
    const sendEmail = createSendEmailMock();
    const rawBody = JSON.stringify(buildAlertEvent({
      payload: {
        alerts: [buildAlert({
          title: "Function invocation\r\nBcc: attacker@example.test",
        })],
        links: {
          observability: "https://attacker.example.test/collect",
        },
      },
    }));

    await handleHostedVercelAnomalyWebhook({
      env: ALERT_ENV,
      rawBody,
      sendEmail,
      signature: sign(rawBody),
    });

    expect(sendEmail.mock.calls[0]?.[0].text).toContain(
      "Function invocation Bcc: attacker@example.test",
    );
    expect(sendEmail.mock.calls[0]?.[0].text).not.toContain("\r");
    expect(sendEmail.mock.calls[0]?.[0].text).not.toContain(
      "https://attacker.example.test",
    );
  });

  it("keeps tiny baselines visible and puts investigation before bounded details", async () => {
    const sendEmail = createSendEmailMock();
    const alerts = Array.from({ length: 21 }, (_, index) => buildAlert({
      alertId: `alrt_${index + 1}`,
      ...(index === 0
        ? {
            average: 0.004,
            stddev: 0.0008,
          }
        : {}),
      title: `Function invocation anomaly ${index + 1}`,
    }));
    const rawBody = JSON.stringify(buildAlertEvent({
      payload: { alerts },
    }));

    await handleHostedVercelAnomalyWebhook({
      env: ALERT_ENV,
      rawBody,
      sendEmail,
      signature: sign(rawBody),
    });

    const text = sendEmail.mock.calls[0]?.[0].text ?? "";
    expect(text).toContain("Baseline: 0.004 requests");
    expect(text).toContain("Standard deviation: 0.0008 requests");
    expect(text).toContain("Additional grouped alerts omitted: 1");
    expect(text).toContain("20. Function invocation anomaly 20");
    expect(text).not.toContain("21. Function invocation anomaly 21");
    expect(text.indexOf("Open in Vercel:")).toBeLessThan(
      text.indexOf("1. Function invocation anomaly 1"),
    );
  });

  it("fails visibly when shared operational email config is incomplete", async () => {
    const sendEmail = createSendEmailMock();
    const rawBody = JSON.stringify(buildAlertEvent());

    await expect(handleHostedVercelAnomalyWebhook({
      env: {
        HOSTED_WEB_VERCEL_ALERT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      },
      rawBody,
      sendEmail,
      signature: sign(rawBody),
    })).rejects.toMatchObject({
      code: "HOSTED_VERCEL_ALERT_EMAIL_NOT_CONFIGURED",
      httpStatus: 503,
      retryable: true,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("converts a Resend rejection into a retryable webhook failure", async () => {
    const sendEmail = vi.fn<VercelAlertEmailSend>(async () => {
      throw new HostedResendPlainTextEmailError("Provider rejected send.", {
        code: "RESEND_SEND_FAILED",
        providerStatus: 503,
      });
    });
    const rawBody = JSON.stringify(buildAlertEvent());

    const result = handleHostedVercelAnomalyWebhook({
      env: ALERT_ENV,
      rawBody,
      sendEmail,
      signature: sign(rawBody),
    });

    await expect(result).rejects.toSatisfy((error: unknown) => (
      error instanceof HostedOnboardingError
      && error.code === "HOSTED_VERCEL_ALERT_EMAIL_SEND_FAILED"
      && error.httpStatus === 502
      && error.retryable
      && error.details?.code === "RESEND_SEND_FAILED"
      && error.details?.statusCode === 503
    ));
  });
});

function sign(rawBody: string): string {
  return createHmac("sha1", WEBHOOK_SECRET).update(rawBody).digest("hex");
}

function buildAlertEvent(input: {
  payload?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    createdAt: Date.parse("2026-08-28T15:05:00.000Z"),
    id: "evt_vercel_alert_123",
    payload: {
      alerts: [buildAlert()],
      links: {
        observability: "https://vercel.com/acme/murph-web/observability",
      },
      projectSlug: "murph-web",
      startedAt: Date.parse("2026-08-28T15:00:00.000Z"),
      teamSlug: "acme",
      ...input.payload,
    },
    region: "iad1",
    type: "alerts.triggered",
  };
}

function buildAlert(input: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    alertId: "alrt_function_invocations",
    average: 1_024,
    count: 10_240,
    formattedValues: {
      average: "1.02k",
      count: "10.24k",
    },
    metric: "function_invocations",
    startedAt: "2026-08-28T15:00:00.000Z",
    stddev: 1_084.24,
    title: "Function invocation usage anomaly",
    type: "usage_anomaly",
    unit: "requests",
    zscore: 8.5,
    zscoreThreshold: 4,
    ...input,
  };
}
