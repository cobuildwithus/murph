import "server-only";

import type { PrismaClient } from "@prisma/client";

import { revokeAllMealPhotoCaptureEnrollmentsForMember } from "../device-sync/meal-photo-capture";
import { disconnectAllHostedDeviceSyncConnectionsForUser } from "../device-sync/public-ingress-service";
import { formatHostedExecutionSafeLogErrorDetails } from "../hosted-execution/logging";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { terminateHostedUserRuntimeWorkflowBestEffort } from "../hosted-orchestration/workflow-termination";
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
  let consentStillRevoked = false;
  await runWithdrawalCleanup("consent state", async () => {
    consentStillRevoked = await readHostedHealthDataConsentState({
      memberId: input.memberId,
      prisma: input.prisma,
    }) === "revoked";
  });
  if (!consentStillRevoked) {
    return;
  }

  // Stop in-flight processing first. Provider cleanup is intentionally
  // best-effort and cannot change the already committed withdrawal result.
  await terminateHostedUserRuntimeWorkflowBestEffort({
    reason: "health-data-consent-withdrawn",
    userId: input.memberId,
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
