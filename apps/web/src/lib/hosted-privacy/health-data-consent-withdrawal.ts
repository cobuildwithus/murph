import "server-only";

import { lockHostedMemberRow } from "../hosted-onboarding/shared";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { CloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";

import { revokeAllMealPhotoCaptureEnrollmentsForMember } from "../device-sync/meal-photo-capture";
import { disconnectAllHostedDeviceSyncConnectionsForUser } from "../device-sync/public-ingress-service";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { formatHostedExecutionSafeLogErrorDetails } from "../hosted-execution/logging";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  readHostedConsentStatus,
  readHostedHealthDataConsentState,
  revokeHostedConsentScope,
  type HostedConsentStatus,
} from "../legal/consent";

export async function withdrawHostedHealthDataConsent(input: {
  memberId: string;
  prisma: PrismaClient;
  source?: string;
}): Promise<HostedConsentStatus> {
  const priorState = await readHostedHealthDataConsentState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (priorState === "missing") {
    throw hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      httpStatus: 409,
      message: "Review the current health data consent before changing it.",
    });
  }

  // The grant is the authority boundary. Revoke it before provider cleanup so
  // independently guarded processing paths fail closed immediately.
  return priorState === "revoked"
    ? await readHostedConsentStatus({
        memberId: input.memberId,
        prisma: input.prisma,
      })
    : await revokeHostedConsentScope({
        memberId: input.memberId,
        prisma: input.prisma,
        scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
        source: input.source,
      });
}

export async function cleanupWithdrawnHostedHealthDataConsent(input: {
  memberId: string;
  prisma: PrismaClient;
  request: Request;
}): Promise<void> {
  await runWithdrawalCleanup("clinical records", async () => {
    await input.prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.memberId);
      if (await readHostedHealthDataConsentState({ memberId: input.memberId, prisma: tx }) !== "revoked") return;
      const now = new Date();
      await tx.clinicalRecordConnection.updateMany({
        where: { memberId: input.memberId },
        data: {
          accessTokenEncrypted: null,
          accessTokenExpiresAt: null,
          patientIdEncrypted: null,
          disconnectedAt: now,
          status: "disconnected",
        },
      });
      await tx.clinicalRecordRetrievalRun.updateMany({
        where: {
          memberId: input.memberId,
          OR: [
            { completedAt: null },
            { status: "needs_reauth", outcomeCountsJson: { equals: Prisma.DbNull } },
          ],
        },
        data: { completedAt: now, status: "canceled" },
      });
      await tx.clinicalRecordOauthSession.deleteMany({ where: { memberId: input.memberId } });
      await tx.clinicalRecordConnectIntent.deleteMany({ where: { memberId: input.memberId } });
    });
  });
  await runWithdrawalCleanup("device connections", async () => {
    await disconnectAllHostedDeviceSyncConnectionsForUser({
      request: input.request,
      userId: input.memberId,
    });
  });
  await runWithdrawalCleanup("meal photo capture", async () => {
    await revokeAllMealPhotoCaptureEnrollmentsForMember({
      memberId: input.memberId,
      prisma: input.prisma,
    });
  });
}

export async function reconcileHostedHealthDataRuntimeConsent(input: {
  client?: Pick<CloudflareHostedControlClient, "reconcileRuntimeHealthDataConsent"> | null;
  memberId: string;
}) {
  const client = input.client === undefined
    ? readHostedExecutionControlClientIfConfigured()
    : input.client;
  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_HEALTH_DATA_RUNTIME_CONTROL_NOT_CONFIGURED",
      httpStatus: 503,
      message: "Murph could not confirm the health data processing state. Try again.",
      retryable: true,
    });
  }

  try {
    return await client.reconcileRuntimeHealthDataConsent(input.memberId);
  } catch (error) {
    console.error("Hosted health-data runtime consent reconciliation failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_HEALTH_DATA_RUNTIME_CONSENT_RECONCILIATION_FAILED",
      }),
      operationMessage: "Hosted health-data runtime consent reconciliation failed.",
    });
    throw hostedOnboardingError({
      code: "HOSTED_HEALTH_DATA_RUNTIME_CONSENT_RECONCILIATION_FAILED",
      httpStatus: 503,
      message: "Murph could not confirm the health data processing state. Try again.",
      retryable: true,
    });
  }
}

async function runWithdrawalCleanup(
  operation: string,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    console.error("Hosted health-data consent withdrawal cleanup failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_HEALTH_DATA_CONSENT_WITHDRAWAL_CLEANUP_FAILED",
      }),
      operation,
      operationMessage: "Hosted health-data consent withdrawal cleanup failed.",
    });
  }
}
