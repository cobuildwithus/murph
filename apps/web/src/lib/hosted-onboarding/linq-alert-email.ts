import type { HostedLinqAlert, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { normalizeNullableString, parseCommaSeparatedList, parseInteger } from "../primitives";
import {
  HostedResendPlainTextEmailError,
  sendHostedResendPlainTextEmail,
  type HostedResendPlainTextEmailConfig,
} from "./resend-plain-text-email";

type HostedLinqAlertEmailEnv = Readonly<Record<string, string | undefined>>;

const HOSTED_LINQ_ALERT_EMAIL_DEFAULT_TIMEOUT_MS = 10_000;
const HOSTED_LINQ_ALERT_EMAIL_MIN_TIMEOUT_MS = 1_000;
const HOSTED_LINQ_ALERT_EMAIL_MAX_TIMEOUT_MS = 30_000;

export async function sendPendingHostedLinqAlertsBestEffort(input: {
  alertIds: readonly string[];
  env?: HostedLinqAlertEmailEnv;
  fetchImpl?: typeof fetch;
  prisma?: PrismaClient;
}): Promise<void> {
  if (input.alertIds.length === 0) {
    return;
  }

  try {
    await sendPendingHostedLinqAlerts(input);
  } catch (error) {
    console.warn("Hosted Linq alert email batch failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function sendPendingHostedLinqAlerts(input: {
  alertIds: readonly string[];
  env?: HostedLinqAlertEmailEnv;
  fetchImpl?: typeof fetch;
  prisma?: PrismaClient;
}): Promise<void> {
  const config = readHostedLinqAlertEmailConfig(input.env ?? process.env);
  if (!config) {
    return;
  }

  const prisma = input.prisma ?? getPrisma();
  const alerts = await prisma.hostedLinqAlert.findMany({
    where: {
      id: { in: [...input.alertIds] },
      status: { in: ["pending", "failed"] },
    },
    orderBy: {
      claimedAt: "asc",
    },
  });

  for (const alert of alerts) {
    await sendHostedLinqAlertEmail({
      alert,
      config,
      fetchImpl: input.fetchImpl,
      prisma,
    });
  }
}

async function sendHostedLinqAlertEmail(input: {
  alert: HostedLinqAlert;
  config: HostedLinqAlertEmailConfig;
  fetchImpl?: typeof fetch;
  prisma: PrismaClient;
}): Promise<void> {
  const claim = await input.prisma.hostedLinqAlert.updateMany({
    where: {
      id: input.alert.id,
      status: { in: ["pending", "failed"] },
    },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptedAt: new Date(),
      status: "sending",
    },
  });
  if (claim.count !== 1) {
    return;
  }

  try {
    const result = await sendHostedResendPlainTextEmail({
      config: input.config.resend,
      fetchImpl: input.fetchImpl,
      idempotencyKey: buildHostedLinqAlertEmailIdempotencyKey(input.alert.id),
      subject: input.alert.subject,
      text: buildHostedLinqAlertEmailText(input.alert),
      to: input.config.recipients,
    });
    await input.prisma.hostedLinqAlert.update({
      where: { id: input.alert.id },
      data: {
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        status: "sent",
      },
    });
  } catch (error) {
    await input.prisma.hostedLinqAlert.update({
      where: { id: input.alert.id },
      data: {
        lastErrorCode: error instanceof HostedResendPlainTextEmailError
          ? error.code
          : error instanceof Error
            ? error.name
            : "UNKNOWN_ALERT_EMAIL_ERROR",
        lastProviderStatus: error instanceof HostedResendPlainTextEmailError
          ? error.providerStatus
          : null,
        status: "failed",
      },
    });
  }
}

type HostedLinqAlertEmailConfig = {
  recipients: string[];
  resend: HostedResendPlainTextEmailConfig;
};

function readHostedLinqAlertEmailConfig(source: HostedLinqAlertEmailEnv): HostedLinqAlertEmailConfig | null {
  const apiKey = normalizeNullableString(source.RESEND_API_KEY);
  const from = normalizeNullableString(source.HOSTED_LINQ_ALERT_EMAIL_FROM);
  const recipients = parseCommaSeparatedList(source.HOSTED_LINQ_ALERT_EMAILS);
  if (!apiKey || !from || recipients.length === 0) {
    return null;
  }

  return {
    recipients,
    resend: {
      apiKey,
      from,
      timeoutMs: readHostedLinqAlertEmailTimeoutMs(source),
    },
  };
}

function readHostedLinqAlertEmailTimeoutMs(source: HostedLinqAlertEmailEnv): number {
  const configured = parseInteger(source.HOSTED_LINQ_ALERT_EMAIL_TIMEOUT_MS);
  if (!configured) {
    return HOSTED_LINQ_ALERT_EMAIL_DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(configured, HOSTED_LINQ_ALERT_EMAIL_MIN_TIMEOUT_MS),
    HOSTED_LINQ_ALERT_EMAIL_MAX_TIMEOUT_MS,
  );
}

function buildHostedLinqAlertEmailText(alert: HostedLinqAlert): string {
  const details = alert.detailsJson && typeof alert.detailsJson === "object"
    ? alert.detailsJson as Record<string, unknown>
    : {};
  return [
    "Linq operational alert.",
    "",
    `Kind: ${alert.kind}`,
    alert.phoneNumberHint ? `Line: ${alert.phoneNumberHint}` : null,
    `Alert ID: ${alert.id}`,
    typeof details.eventType === "string" ? `Event type: ${details.eventType}` : null,
    typeof details.eventIdSuffix === "string" ? `Event ID suffix: ${details.eventIdSuffix}` : null,
    typeof details.service === "string" ? `Service: ${details.service}` : null,
    typeof details.failureCode === "string" ? `Failure code: ${details.failureCode}` : null,
    typeof details.failureReason === "string" ? `Failure reason: ${details.failureReason}` : null,
    typeof details.providerStatus === "string" ? `Provider status: ${details.providerStatus}` : null,
    typeof details.providerReason === "string" ? `Provider reason: ${details.providerReason}` : null,
    typeof details.providerCreatedAt === "string" ? `Provider created at: ${details.providerCreatedAt}` : null,
    "",
    "Action taken: recorded provider event and updated Linq line state only. No routing failover is enabled in this patch.",
  ].filter((line): line is string => line !== null).join("\n");
}

function buildHostedLinqAlertEmailIdempotencyKey(alertId: string): string {
  return `hosted-linq-alert/${alertId}`.slice(0, 256);
}
