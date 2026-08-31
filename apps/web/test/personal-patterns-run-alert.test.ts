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
  it("emails operators for a failed managed run", async () => {
    const sent: SendAlertEmailInput[] = [];

    await expect(sendHostedPersonalPatternsRunAlerts({
      entries: [{
        at: "2026-08-31T13:02:00.000Z",
        errorCode: "ASSISTANT_CODEX_USAGE_LIMIT",
        redactedJson: {
          failureAutomationSlug: "personal-patterns-update",
          failureErrorCode: "ASSISTANT_CODEX_USAGE_LIMIT",
          failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
          failureRunOutcome: "failed",
          type: "cron.job.completed",
        },
      }],
      env: alertEnv,
      memberId: "member_test_1",
      sendEmail: async (input) => {
        sent.push(input);
        return { providerMessageId: "email_1" };
      },
    })).resolves.toBe("sent");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Murph Personal Patterns run failed");
    expect(sent[0]?.text).toContain("member: member_test_1");
    expect(sent[0]?.text).toContain("error code: ASSISTANT_CODEX_USAGE_LIMIT");
    expect(sent[0]?.text).not.toContain("health");
  });

  it("emails operators once per expired occurrence through a stable key", async () => {
    const keys: string[] = [];
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
        memberId: "member_test_1",
        sendEmail: async (input) => {
          keys.push(input.idempotencyKey);
          return { providerMessageId: "email_1" };
        },
      });
    }

    expect(new Set(keys).size).toBe(1);
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
      memberId: "member_test_1",
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
          failureOccurrenceAt: "2026-08-31T13:00:00.000Z",
          failureRunOutcome: "failed",
          type: "cron.job.completed",
        },
      }],
      env: {},
      memberId: "member_test_1",
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
      memberId: "member_test_1",
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
