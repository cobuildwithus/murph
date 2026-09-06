import { describe, expect, it, vi } from "vitest";

import {
  sendHostedPersonalPatternsRunAlerts,
} from "@/src/lib/hosted-runtime-log/personal-patterns-run-alert";
import type { sendHostedResendPlainTextEmail } from "@/src/lib/hosted-onboarding/resend-plain-text-email";

type SendAlertEmailInput = Parameters<typeof sendHostedResendPlainTextEmail>[0];

const alertEnv = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "ops@example.test, founder@example.test",
  RESEND_API_KEY: "re_test",
};

describe("Personal Patterns run alerts", () => {
  it("ignores a failed managed run while automatic recovery is pending", async () => {
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(sendHostedPersonalPatternsRunAlerts({
      entries: [{
        at: "2026-08-31T13:02:00.000Z",
        errorCode: "ASSISTANT_CODEX_CONNECTION_LOST",
        redactedJson: {
          failureAutomationSlug: "personal-patterns-update",
          failureErrorCode: "ASSISTANT_CODEX_CONNECTION_LOST",
          failureRetryScheduled: true,
          failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
          failureRunOutcome: "failed",
          type: "cron.job.completed",
        },
      }],
      env: alertEnv,
      sendEmail,
    })).resolves.toBe("unrelated");

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("ignores failed events from an older runtime without retry disposition", async () => {
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(sendHostedPersonalPatternsRunAlerts({
      entries: [{
        at: "2026-08-31T13:02:00.000Z",
        redactedJson: {
          failureAutomationSlug: "personal-patterns-update",
          failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
          failureRunOutcome: "failed",
          type: "cron.job.completed",
        },
      }],
      env: alertEnv,
      sendEmail,
    })).resolves.toBe("unrelated");

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails operators for a terminal managed run failure", async () => {
    const sent: SendAlertEmailInput[] = [];

    await expect(sendHostedPersonalPatternsRunAlerts({
      entries: [{
        at: "2026-08-31T13:02:00.000Z",
        errorCode: "ASSISTANT_CODEX_USAGE_LIMIT",
        redactedJson: {
          failureAutomationSlug: "personal-patterns-update",
          failureErrorCode: "ASSISTANT_CODEX_USAGE_LIMIT",
          failureRetryScheduled: false,
          failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
          failureRunOutcome: "failed",
          type: "cron.job.completed",
        },
      }],
      env: alertEnv,
      sendEmail: async (input) => {
        sent.push(input);
        return { providerMessageId: "email_1" };
      },
    })).resolves.toBe("sent");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Murph Personal Patterns runs need attention");
    expect(sent[0]?.text).toContain("expired or ended with a terminal failure");
    expect(sent[0]?.text).not.toContain("after automatic recovery");
    expect(sent[0]?.text).toContain(
      "scheduled occurrence: 2026-08-31T13:00:00.000Z",
    );
    expect(sent[0]?.text).not.toContain("member");
    expect(sent[0]?.text).not.toContain("ASSISTANT_CODEX_USAGE_LIMIT");
    expect(sent[0]?.text).not.toContain("health");
  });

  it("coalesces different members for one expired occurrence", async () => {
    const sends: SendAlertEmailInput[] = [];
    const entry = {
      at: "2026-08-31T17:00:00.000Z",
      redactedJson: {
        failureAutomationSlug: "personal-patterns-update",
        failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
        type: "cron.occurrence.expired",
      },
    };

    for (const observedAt of [
      "2026-08-31T17:00:00.000Z",
      "2026-08-31T17:05:00.000Z",
    ]) {
      await sendHostedPersonalPatternsRunAlerts({
        entries: [{ ...entry, at: observedAt }],
        env: alertEnv,
        sendEmail: async (input) => {
          sends.push(input);
          return { providerMessageId: "email_1" };
        },
      });
    }

    expect(new Set(sends.map((send) => send.idempotencyKey)).size).toBe(1);
    expect(new Set(sends.map((send) => send.text)).size).toBe(1);
    expect(sends[0]?.text).toContain("may not have reached model execution");
    expect(sends[0]?.text).toContain("cron.occurrence.expired");
    expect(sends[0]?.text).toContain("nextDefaultProcessingWakeState");
    expect(sends[0]?.text).toContain("nextDefaultProcessingWakeOffsetMs");
  });

  it("keeps one stable email across terminal failures and expirations", async () => {
    const sends: SendAlertEmailInput[] = [];
    const common = {
      at: "2026-08-31T17:00:00.000Z",
      redactedJson: {
        failureAutomationSlug: "personal-patterns-update",
        failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
      },
    };
    const expired = {
      ...common,
      redactedJson: {
        ...common.redactedJson,
        failureLatenessMinutes: 240,
        failurePriorFailureCount: 0,
        type: "cron.occurrence.expired",
      },
    };
    const failed = {
      ...common,
      redactedJson: {
        ...common.redactedJson,
        failureRetryScheduled: false,
        failureRunOutcome: "failed",
        type: "cron.job.completed",
      },
    };
    for (const entries of [[expired], [failed], [failed, expired]]) {
      await sendHostedPersonalPatternsRunAlerts({
        entries,
        env: alertEnv,
        sendEmail: async (input) => {
          sends.push(input);
          return { providerMessageId: "email_1" };
        },
      });
    }
    expect(sends).toHaveLength(3);
    expect(new Set(sends.map((send) => send.idempotencyKey)).size).toBe(1);
    expect(new Set(sends.map((send) => send.text)).size).toBe(1);
    expect(sends[0]?.text).not.toContain("240");
  });

  it("ignores other automations and successful Patterns runs", async () => {
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(sendHostedPersonalPatternsRunAlerts({
      entries: [
        {
          at: "2026-08-31T13:02:00.000Z",
          redactedJson: {
            failureAutomationSlug: "weekly-health-digest",
            failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
            failureRunOutcome: "failed",
            type: "cron.job.completed",
          },
        },
        {
          at: "2026-08-31T13:02:00.000Z",
          redactedJson: {
            failureAutomationSlug: "personal-patterns-update",
            failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
            failureRunOutcome: "no_op",
            type: "cron.job.completed",
          },
        },
      ],
      env: alertEnv,
      sendEmail,
    })).resolves.toBe("unrelated");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips delivery when operational email is not configured", async () => {
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(sendHostedPersonalPatternsRunAlerts({
      entries: [{
        at: "2026-08-31T13:02:00.000Z",
        redactedJson: {
          failureAutomationSlug: "personal-patterns-update",
          failureRetryScheduled: false,
          failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
          failureRunOutcome: "failed",
          type: "cron.job.completed",
        },
      }],
      env: {},
      sendEmail,
    })).resolves.toBe("not_configured");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("attempts later alerts when one delivery fails", async () => {
    let attempts = 0;

    await expect(sendHostedPersonalPatternsRunAlerts({
      entries: [
        {
          at: "2026-08-31T13:02:00.000Z",
          redactedJson: {
            failureAutomationSlug: "personal-patterns-update",
            failureRetryScheduled: false,
            failureOccurrenceAt: "2026-08-30T13:00:00.000Z",
            failureRunOutcome: "failed",
            type: "cron.job.completed",
          },
        },
        {
          at: "2026-08-31T17:00:00.000Z",
          redactedJson: {
            failureAutomationSlug: "personal-patterns-update",
            failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
            type: "cron.occurrence.expired",
          },
        },
      ],
      env: alertEnv,
      sendEmail: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("synthetic Resend outage");
        }
        return { providerMessageId: "email_2" };
      },
    })).rejects.toThrow("synthetic Resend outage");
    expect(attempts).toBe(2);
  });
});
