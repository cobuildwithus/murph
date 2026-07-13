import {
  buildHostedExecutionMealPhotoCapturedWake,
} from "@murphai/hosted-execution";

import {
  readAndValidateMealPhotoUpload,
  requireActiveMealPhotoCaptureEnrollment,
} from "@/src/lib/device-sync/meal-photo-capture";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { appendHostedMailboxEnvelopeTx } from "@/src/lib/hosted-mailbox/store";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const enrollment = await requireActiveMealPhotoCaptureEnrollment({
    prisma,
    request,
  });
  const upload = await readAndValidateMealPhotoUpload(request);
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
  const appended = await prisma.$transaction((tx) =>
    appendHostedMailboxEnvelopeTx({
      envelope,
      tx,
    })
  );
  if (appended.dedupeConflict) {
    throw hostedOnboardingError({
      code: "MEAL_PHOTO_DEDUPE_CONFLICT",
      httpStatus: 422,
      message: "Meal photo upload conflicts with an earlier capture.",
    });
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
