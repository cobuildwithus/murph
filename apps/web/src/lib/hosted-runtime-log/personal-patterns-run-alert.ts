import "server-only";

import { createHash } from "node:crypto";

import { readHostedOperationalAlertEmailConfig } from "../hosted-onboarding/operational-alert-email-config";
import { sendHostedResendPlainTextEmail } from "../hosted-onboarding/resend-plain-text-email";

const PERSONAL_PATTERNS_AUTOMATION_SLUG = "personal-patterns-update";

type HostedPersonalPatternsRunAlertEntry = {
  at: string;
  errorCode?: string | null;
  redactedJson?: unknown;
};

type HostedPersonalPatternsRunAlert = {
  errorCode: string;
  kind: "failed" | "missed";
  observedAt: string;
  occurrenceAt: string;
};

export type HostedPersonalPatternsRunAlertOutcome =
  | "not_configured"
  | "sent"
  | "unrelated";

export function hasHostedPersonalPatternsRunAlert(
  entries: readonly HostedPersonalPatternsRunAlertEntry[],
): boolean {
  return entries.some((entry) => readPersonalPatternsRunAlert(entry).length > 0);
}

export async function sendHostedPersonalPatternsRunAlerts(input: {
  entries: readonly HostedPersonalPatternsRunAlertEntry[];
  env?: Readonly<Record<string, string | undefined>>;
  memberId: string;
  sendEmail?: typeof sendHostedResendPlainTextEmail;
}): Promise<HostedPersonalPatternsRunAlertOutcome> {
  const alerts = input.entries.flatMap(readPersonalPatternsRunAlert);
  if (alerts.length === 0) {
    return "unrelated";
  }

  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
  );
  if (!emailConfig) {
    return "not_configured";
  }

  let firstFailure: unknown = null;
  for (const alert of alerts) {
    const alertIdentity = createHash("sha256")
      .update([
        input.memberId,
        PERSONAL_PATTERNS_AUTOMATION_SLUG,
        alert.kind,
        alert.occurrenceAt,
      ].join("\n"))
      .digest("hex")
      .slice(0, 32);

    try {
      await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
        config: emailConfig.resend,
        idempotencyKey: `personal-patterns-run-alert/${alertIdentity}`,
        subject: `Murph Personal Patterns run ${alert.kind}`,
        text: [
          `A Personal Patterns run was ${alert.kind}.`,
          "",
          `observed at: ${alert.observedAt}`,
          `scheduled occurrence: ${alert.occurrenceAt}`,
          `member: ${input.memberId}`,
          `error code: ${alert.errorCode}`,
          "",
          "Inspect the member's hosted runtime logs for the matching occurrence.",
        ].join("\n"),
        to: emailConfig.recipients,
      });
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== null) {
    throw firstFailure;
  }

  return "sent";
}

export async function reportHostedPersonalPatternsRunAlerts(
  input: Parameters<typeof sendHostedPersonalPatternsRunAlerts>[0],
): Promise<void> {
  try {
    await sendHostedPersonalPatternsRunAlerts(input);
  } catch {
    console.warn("Personal Patterns run alert email failed.", {
      alertEntryCount: input.entries.length,
    });
  }
}

function readPersonalPatternsRunAlert(
  entry: HostedPersonalPatternsRunAlertEntry,
): HostedPersonalPatternsRunAlert[] {
  const details = readRecord(entry.redactedJson);
  if (
    readString(details, "failureAutomationSlug")
      !== PERSONAL_PATTERNS_AUTOMATION_SLUG
  ) {
    return [];
  }

  const occurrenceAt = readString(details, "failureOccurrenceAt");
  if (!occurrenceAt) {
    return [];
  }

  const eventType = readString(details, "type");
  if (eventType === "cron.occurrence.expired") {
    return [{
      errorCode: "PERSONAL_PATTERNS_OCCURRENCE_EXPIRED",
      kind: "missed",
      observedAt: entry.at,
      occurrenceAt,
    }];
  }

  if (
    eventType !== "cron.job.completed"
    || readString(details, "failureRunOutcome") !== "failed"
  ) {
    return [];
  }

  return [{
    errorCode:
      readString(details, "failureErrorCode")
      ?? entry.errorCode
      ?? "PERSONAL_PATTERNS_RUN_FAILED",
    kind: "failed",
    observedAt: entry.at,
    occurrenceAt,
  }];
}

function readRecord(value: unknown): object | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function readString(record: object | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = Reflect.get(record, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}
