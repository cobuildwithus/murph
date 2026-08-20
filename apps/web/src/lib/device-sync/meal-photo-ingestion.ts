import "server-only";

import {
  buildHostedExecutionMealPhotoCapturedWake,
} from "@murphai/hosted-execution";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { ValidatedMealPhotoUpload } from "./meal-photo-capture";
import {
  runWithHostedDomainRootProviderCallsDisabled,
} from "../hosted-crypto/domain-root-unwrap-cache";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import {
  appendHostedMealPhotoMailboxEnvelopeTx,
  readHostedMailboxWakeAfterDedupeLockTx,
  runWithPreparedHostedMailboxItemAppendCrypto,
} from "../hosted-mailbox/store";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import {
  assertPreparedHostedMemberDirectRouteTx,
  prepareCurrentHostedMemberDirectRoute,
} from "../hosted-routing/member-direct-route";

export interface IngestCompanionMealPhotoResult {
  accepted: true;
  duplicate: boolean;
}

export async function ingestCompanionMealPhoto(input: {
  assertCurrentAuthorityTx: (tx: Prisma.TransactionClient) => Promise<void>;
  directRouteRequiredMessage: string;
  eventId: string;
  memberId: string;
  prisma: PrismaClient;
  upload: ValidatedMealPhotoUpload;
}): Promise<IngestCompanionMealPhotoResult> {
  const preparedDirectRoute = await prepareCurrentHostedMemberDirectRoute({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if (!preparedDirectRoute) {
    throw hostedOnboardingError({
      code: "MEAL_PHOTO_CAPTURE_DIRECT_ROUTE_REQUIRED",
      httpStatus: 409,
      message: input.directRouteRequiredMessage,
      retryable: false,
    });
  }

  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) {
    throw hostedOnboardingError({
      code: "MEAL_PHOTO_STORAGE_UNAVAILABLE",
      httpStatus: 503,
      message: "Meal photo storage is temporarily unavailable.",
      retryable: true,
    });
  }

  const staged = await control.stageMealPhoto({
    bytes: input.upload.bytes,
    captureId: input.upload.captureId,
    sha256: input.upload.sha256,
    userId: input.memberId,
  });
  const envelope = buildHostedExecutionMealPhotoCapturedWake({
    byteLength: staged.byteLength,
    captureId: input.upload.captureId,
    capturedAt: input.upload.capturedAt,
    directRoute: preparedDirectRoute.directRoute,
    eventId: input.eventId,
    mealPhotoKey: staged.mealPhotoKey,
    memberId: input.memberId,
    occurredAt: input.upload.capturedAt,
    sha256: staged.sha256,
  });

  let appended: Awaited<ReturnType<typeof appendHostedMealPhotoMailboxEnvelopeTx>>;
  try {
    appended = await runWithPreparedHostedMailboxItemAppendCrypto({
      append: (prepared) => input.prisma.$transaction(
        (tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
          await input.assertCurrentAuthorityTx(tx);
          await assertPreparedHostedMemberDirectRouteTx({
            message: input.directRouteRequiredMessage,
            prepared: preparedDirectRoute,
            prisma: tx,
          });
          return await appendHostedMealPhotoMailboxEnvelopeTx({
            envelope,
            prepared,
            tx,
          });
        }),
        HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      ),
      prisma: input.prisma,
      userId: input.memberId,
    });
    if (appended.dedupeConflict) {
      throw hostedOnboardingError({
        code: "MEAL_PHOTO_DEDUPE_CONFLICT",
        httpStatus: 422,
        message: "Meal photo upload conflicts with an earlier capture.",
      });
    }
  } catch (error) {
    await deleteUnclaimedStaging({
      deleteMealPhoto: () => control.deleteMealPhoto({
        mealPhotoKey: staged.mealPhotoKey,
        userId: input.memberId,
      }),
      eventId: input.eventId,
      mealPhotoKey: staged.mealPhotoKey,
      prisma: input.prisma,
      userId: input.memberId,
    });
    throw error;
  }

  if (appended.claimedMealPhotoKey !== staged.mealPhotoKey) {
    await deleteStagingOrRetain(() => control.deleteMealPhoto({
      mealPhotoKey: staged.mealPhotoKey,
      userId: input.memberId,
    }));
  }

  // Re-signal exact duplicates too: an earlier request may have committed the
  // mailbox row and then lost its runtime wake response.
  await signalHostedMailboxAppendRuntime({
    expectedUserId: input.memberId,
    mailboxItemId: appended.item.id,
  });

  return {
    accepted: true,
    duplicate: appended.duplicate,
  };
}

async function deleteUnclaimedStaging(input: {
  deleteMealPhoto: () => Promise<void>;
  eventId: string;
  mealPhotoKey: string;
  prisma: PrismaClient;
  userId: string;
}): Promise<void> {
  try {
    const claimed = await input.prisma.$transaction(
      async (tx) => await readHostedMailboxWakeAfterDedupeLockTx({
        dedupeKey: input.eventId,
        tx,
        userId: input.userId,
      }),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    if (
      claimed?.kind === "meal-photo.captured"
      && claimed.mealPhoto.mealPhotoKey === input.mealPhotoKey
    ) {
      return;
    }
  } catch {
    console.warn("Meal photo staging ownership was ambiguous; lifecycle cleanup retained it.");
    return;
  }
  await deleteStagingOrRetain(input.deleteMealPhoto);
}

async function deleteStagingOrRetain(deleteMealPhoto: () => Promise<void>): Promise<void> {
  try {
    await deleteMealPhoto();
  } catch {
    console.warn("Meal photo staging cleanup failed; lifecycle cleanup retained it.");
  }
}
