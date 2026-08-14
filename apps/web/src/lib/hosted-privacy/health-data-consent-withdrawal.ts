import "server-only";

import type { PrismaClient } from "@prisma/client";
import type { CloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";

import { revokeAllMealPhotoCaptureEnrollmentsForMember } from "../device-sync/meal-photo-capture";
import { disconnectAllHostedDeviceSyncConnectionsForUser } from "../device-sync/public-ingress-service";
import {
  createMemberOwnedProviderSetupService,
  readMemberOwnedProviderSetupRegistration,
} from "../device-sync/provider-setup";
import { PrismaDeviceProviderSetupStore } from "../device-sync/provider-setup/store";
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
  await runWithdrawalCleanup("device connections", async () => {
    await disconnectAllHostedDeviceSyncConnectionsForUser({
      request: input.request,
      userId: input.memberId,
    });
    const setupStore = new PrismaDeviceProviderSetupStore(input.prisma);
    const providers = new Set(
      (await setupStore.listMemberSetups(input.memberId))
        .filter((setup) => setup.active)
        .map((setup) => setup.provider),
    );
    for (const provider of providers) {
      const registration = readMemberOwnedProviderSetupRegistration(provider);
      if (!registration) {
        continue;
      }
      await createMemberOwnedProviderSetupService(
        registration.coordinates.provider,
      ).reconcileConsentWithdrawal(input.memberId);
    }
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
