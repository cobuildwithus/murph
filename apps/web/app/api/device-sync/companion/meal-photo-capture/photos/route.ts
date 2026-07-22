import {
  buildHostedExecutionMealPhotoCapturedWake,
} from "@murphai/hosted-execution";

import {
  assertCurrentMealPhotoCaptureEnrollmentTx,
  readAndValidateMealPhotoUpload,
  requireActiveMealPhotoCaptureEnrollment,
} from "@/src/lib/device-sync/meal-photo-capture";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import {
  appendHostedMealPhotoMailboxEnvelopeTx,
  readHostedMailboxWakeAfterDedupeLockTx,
} from "@/src/lib/hosted-mailbox/store";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { readCurrentHostedMemberDirectRoute } from "@/src/lib/hosted-routing/member-direct-route";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const enrollment = await requireActiveMealPhotoCaptureEnrollment({
    prisma,
    request,
  });
  const upload = await readAndValidateMealPhotoUpload(request);
  await requireMealPhotoDirectRoute({
    memberId: enrollment.memberId,
    prisma,
  });
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
    bytes: upload.bytes,
    captureId: upload.captureId,
    sha256: upload.sha256,
    userId: enrollment.memberId,
  });
  const eventId = `meal-photo:${enrollment.enrollmentId}:${upload.captureId}`;
  const envelope = buildHostedExecutionMealPhotoCapturedWake({
    byteLength: staged.byteLength,
    captureId: upload.captureId,
    capturedAt: upload.capturedAt,
    eventId,
    mealPhotoKey: staged.mealPhotoKey,
    memberId: enrollment.memberId,
    occurredAt: upload.capturedAt,
    sha256: staged.sha256,
  });
  let appended: Awaited<ReturnType<typeof appendHostedMealPhotoMailboxEnvelopeTx>>;
  try {
    appended = await prisma.$transaction(async (tx) => {
      await assertCurrentMealPhotoCaptureEnrollmentTx({
        enrollment,
        prisma: tx,
        request,
      });
      await requireMealPhotoDirectRoute({
        memberId: enrollment.memberId,
        prisma: tx,
      });
      return await appendHostedMealPhotoMailboxEnvelopeTx({
        envelope,
        tx,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
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
        userId: enrollment.memberId,
      }),
      eventId,
      mealPhotoKey: staged.mealPhotoKey,
      prisma,
      userId: enrollment.memberId,
    });
    throw error;
  }

  if (appended.claimedMealPhotoKey !== staged.mealPhotoKey) {
    await deleteStagingOrRetain(() => control.deleteMealPhoto({
      mealPhotoKey: staged.mealPhotoKey,
      userId: enrollment.memberId,
    }));
  }

  // Re-signal exact duplicates too: an earlier request may have committed the
  // mailbox row and then lost its runtime wake response.
  await signalHostedMailboxAppendRuntime({
    expectedUserId: enrollment.memberId,
    mailboxItemId: appended.item.id,
  });

  return jsonOk({
    accepted: true,
    duplicate: appended.duplicate,
  }, 202);
});

async function requireMealPhotoDirectRoute(input: {
  memberId: string;
  prisma: Parameters<typeof readCurrentHostedMemberDirectRoute>[0]["prisma"];
}) {
  const route = await readCurrentHostedMemberDirectRoute(input);
  if (route) return route;
  throw hostedOnboardingError({
    code: "MEAL_PHOTO_PRIVATE_ROUTE_UNAVAILABLE",
    httpStatus: 503,
    message: "A private Murph conversation is required before meal photos can be captured.",
    retryable: true,
  });
}

async function deleteUnclaimedStaging(input: {
  deleteMealPhoto: () => Promise<void>;
  eventId: string;
  mealPhotoKey: string;
  prisma: ReturnType<typeof getPrisma>;
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
