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
  sendEmail?: typeof sendHostedResendPlainTextEmail;
}): Promise<HostedPersonalPatternsRunAlertOutcome> {
  const occurrenceTimes = [
    ...new Set(
      input.entries
        .flatMap(readPersonalPatternsRunAlert)
        .map((alert) => alert.occurrenceAt),
    ),
  ];
  if (occurrenceTimes.length === 0) {
    return "unrelated";
  }

  const emailConfig = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
  );
  if (!emailConfig) {
    return "not_configured";
  }

  let firstFailure: unknown = null;
  for (const occurrenceAt of occurrenceTimes) {
    const alertIdentity = createHash("sha256")
      .update([
        "v2",
        PERSONAL_PATTERNS_AUTOMATION_SLUG,
        occurrenceAt,
      ].join("\n"))
      .digest("hex")
      .slice(0, 32);

    try {
      await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
        config: emailConfig.resend,
        idempotencyKey: `personal-patterns-run-alert/${alertIdentity}`,
        subject: "Murph Personal Patterns runs need attention",
        text: [
          "One or more Personal Patterns runs expired or ended with a terminal failure.",
          "",
          `scheduled occurrence: ${occurrenceAt}`,
          "",
          "An expired occurrence may not have reached model execution.",
          "Inspect hosted runtime logs for the matching occurrence: cron.occurrence.expired reports lateness and recorded prior failures; cron.job.completed reports the terminal outcome.",
          "For a late wake, inspect checkpoint.snapshot_finished and its nextDefaultProcessingWakeState and nextDefaultProcessingWakeOffsetMs fields.",
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
    const alertEntryCount = input.entries.length;
    console.warn("Personal Patterns run alert email failed.", {
      alertEntryCount,
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
      occurrenceAt,
    }];
  }

  if (
    eventType !== "cron.job.completed"
    || readString(details, "failureRunOutcome") !== "failed"
    || readBoolean(details, "failureRetryScheduled") !== false
  ) {
    return [];
  }

  return [{
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

function readBoolean(record: object | null, key: string): boolean | null {
  if (!record) {
    return null;
  }
  const value = Reflect.get(record, key);
  return typeof value === "boolean" ? value : null;
}
