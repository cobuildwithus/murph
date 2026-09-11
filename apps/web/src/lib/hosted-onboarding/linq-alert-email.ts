import type { HostedLinqAlert, PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  readHostedOperationalAlertEmailConfig,
  type HostedOperationalAlertEmailConfig,
} from "./operational-alert-email-config";
import {
  HostedResendPlainTextEmailError,
  sendHostedResendPlainTextEmail,
} from "./resend-plain-text-email";

type HostedLinqAlertEmailEnv = Readonly<Record<string, string | undefined>>;

const HOSTED_LINQ_ALERT_EMAIL_SENDING_LEASE_MS = 15 * 60 * 1000;

export async function sendPendingHostedLinqAlertsBestEffort(input: {
  alertIds: readonly string[];
  env?: HostedLinqAlertEmailEnv;
  fetchImpl?: typeof fetch;
  prisma?: Pick<PrismaClient, "hostedLinqAlert">;
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

export async function sendRecoverableHostedLinqAlertsBestEffort(input: {
  env?: HostedLinqAlertEmailEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
  prisma?: Pick<PrismaClient, "hostedLinqAlert">;
} = {}): Promise<void> {
  try {
    await sendPendingHostedLinqAlerts({
      alertIds: [],
      includeRecoverableSending: true,
      ...input,
    });
  } catch (error) {
    console.warn("Hosted Linq alert email recovery failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

async function sendPendingHostedLinqAlerts(input: {
  alertIds: readonly string[];
  env?: HostedLinqAlertEmailEnv;
  fetchImpl?: typeof fetch;
  includeRecoverableSending?: boolean;
  now?: Date;
  prisma?: Pick<PrismaClient, "hostedLinqAlert">;
}): Promise<void> {
  const config = readHostedOperationalAlertEmailConfig(
    input.env ?? process.env,
  );
  if (!config) {
    return;
  }

  const prisma = input.prisma ?? getPrisma();
  const claimableWhere = buildHostedLinqAlertClaimableWhere({
    alertIds: input.alertIds,
    includeRecoverableSending: input.includeRecoverableSending === true,
    now: input.now ?? new Date(),
  });
  const alerts = await prisma.hostedLinqAlert.findMany({
    where: claimableWhere,
    orderBy: {
      claimedAt: "asc",
    },
    take: input.includeRecoverableSending === true ? 50 : undefined,
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
  config: HostedOperationalAlertEmailConfig;
  fetchImpl?: typeof fetch;
  prisma: Pick<PrismaClient, "hostedLinqAlert">;
}): Promise<void> {
  const claim = await input.prisma.hostedLinqAlert.updateMany({
    where: {
      id: input.alert.id,
      OR: buildHostedLinqAlertClaimableStatusWhere(new Date()),
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

function buildHostedLinqAlertClaimableWhere(input: {
  alertIds: readonly string[];
  includeRecoverableSending: boolean;
  now: Date;
}) {
  return {
    ...(input.alertIds.length > 0 ? { id: { in: [...input.alertIds] } } : {}),
    OR: buildHostedLinqAlertClaimableStatusWhere(
      input.includeRecoverableSending ? input.now : null,
    ),
  };
}

function buildHostedLinqAlertClaimableStatusWhere(now: Date | null) {
  return [
    { status: { in: ["pending", "failed"] } },
    ...(now
      ? [
          {
            lastAttemptedAt: {
              lt: new Date(now.getTime() - HOSTED_LINQ_ALERT_EMAIL_SENDING_LEASE_MS),
            },
            status: "sending",
          },
          {
            lastAttemptedAt: null,
            status: "sending",
          },
        ]
      : []),
  ];
}

function buildHostedLinqAlertEmailText(alert: HostedLinqAlert): string {
  const details = alert.detailsJson && typeof alert.detailsJson === "object"
    ? alert.detailsJson as Record<string, unknown>
    : {};
  if (alert.kind === "runtime_warm_typing_slow" || alert.kind === "runtime_cold_typing_slow") {
    return buildHostedTypingAlertEmailText(alert.id, details);
  }
  const independentProviderStatusPresent =
    typeof details.providerServiceStatus === "string"
    || typeof details.providerReputationStatus === "string";
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
    typeof details.providerServiceStatus === "string"
      ? `Line service status: ${details.providerServiceStatus}`
      : null,
    typeof details.providerReputationStatus === "string"
      ? `Line reputation: ${details.providerReputationStatus}`
      : null,
    !independentProviderStatusPresent && typeof details.providerStatus === "string"
      ? `Provider status: ${details.providerStatus}`
      : null,
    typeof details.providerReason === "string" ? `Provider reason: ${details.providerReason}` : null,
    typeof details.providerCreatedAt === "string" ? `Provider created at: ${details.providerCreatedAt}` : null,
    "",
    "Action taken: recorded the provider event and refreshed Linq service and reputation projections. Existing routes stay sticky; current egress policy is evaluated separately at send time.",
  ].filter((line): line is string => line !== null).join("\n");
}

function buildHostedLinqAlertEmailIdempotencyKey(alertId: string): string {
  return `hosted-linq-alert/${alertId}`.slice(0, 256);
}

function buildHostedTypingAlertEmailText(alertId: string, details: Record<string, unknown>): string {
  return [
    "Murph message typing latency alert.",
    "",
    `Alert ID: ${alertId}`,
    `Channel: ${details.source}`,
    `Workspace: ${details.workspaceState}`,
    `Webhook received: ${details.webhookReceivedAt}`,
    details.typingAcceptedAt === null
      ? "Typing acceptance: not observed when checked"
      : `First typing accepted: ${details.typingAcceptedAt}`,
    details.typingAcceptedAt === null
      ? `Time since webhook without recorded typing acceptance: ${details.elapsedMs} ms`
      : `Webhook-to-typing wait: ${details.elapsedMs} ms`,
    `Threshold: strictly greater than ${details.thresholdMs} ms`,
    ...(details.workspaceState === "unconfirmed"
      ? ["Workspace warmth was not confirmed; the 10-second cold-start cutoff applies."] : []),
    "",
    "This is one inbound message. Rollouts and other slow messages do not suppress this alert.",
  ].join("\n");
}
