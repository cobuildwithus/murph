import "server-only";

import { CLEAR_CLINICAL_PERSISTENT_ACCESS } from "../clinical-records/persistent-access";

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

const CONSENT_STOP_REDRIVE_BATCH_SIZE = 8;

/** Selection only nominates: signed reconciliation rereads consent and ownership,
 * so a regrant or replaced owner makes the old stop a no-op. */
export async function redriveHostedHealthDataConsentStops(input: {
  prisma: PrismaClient;
}): Promise<{ configured: boolean; reconciled: number; failed: number }> {
  const client = readHostedExecutionControlClientIfConfigured();
  if (!client) return { configured: false, reconciled: 0, failed: 0 };
  // Stateless rotation keeps persistent failures from occupying every bounded batch.
  const candidates = await input.prisma.$queryRaw<Array<{ memberId: string }>>`
    SELECT consent.member_id AS "memberId"
    FROM hosted_consent_grant AS consent
    JOIN hosted_runtime_owner AS owner ON owner.user_id = consent.member_id
    WHERE consent.scope = ${HOSTED_HEALTH_DATA_CONSENT_SCOPE} AND consent.status = 'revoked'
      AND (owner.phase <> 'idle' OR owner.runner_container_name IS NOT NULL)
    ORDER BY random()
    LIMIT ${CONSENT_STOP_REDRIVE_BATCH_SIZE}
  `;
  const results = await Promise.allSettled(candidates.map(({ memberId }) =>
    reconcileHostedHealthDataRuntimeConsent({ client, memberId })));
  const reconciled = results.filter(result => result.status === "fulfilled").length;
  return { configured: true, reconciled, failed: results.length - reconciled };
}

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
          ...CLEAR_CLINICAL_PERSISTENT_ACCESS,
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
