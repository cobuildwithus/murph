import {
  buildHostedExecutionEnvironmentInterviewCompletedWake,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionEnvironmentInterviewCompletedPayload,
} from "@murphai/hosted-execution/parsers";

import {
  appendHostedMailboxEnvelopeTx,
  hasPendingHostedEnvironmentInterviewMailboxItem,
  readPendingHostedEnvironmentInterviewMailboxItem,
} from "@/src/lib/hosted-mailbox/store";
import { formatHostedExecutionSafeLogErrorDetails } from "@/src/lib/hosted-execution/logging";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { getPrisma } from "@/src/lib/prisma";

const BODY_LIMIT_BYTES = 24 * 1_024;
const COMPLETION_TIME_TOLERANCE_MS = 10 * 60 * 1_000;

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  return jsonOk({
    processing: await hasPendingHostedEnvironmentInterviewMailboxItem({
      userId: auth.member.id,
    }),
  });
});

export const PATCH = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const pendingItem = await readPendingHostedEnvironmentInterviewMailboxItem({
    userId: auth.member.id,
  });
  if (pendingItem) {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: auth.member.id,
      mailboxItemId: pendingItem.id,
    });
  }
  return jsonOk({
    processing: pendingItem !== null,
    recheckRequested: pendingItem !== null,
  });
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const payload = parseHostedExecutionEnvironmentInterviewCompletedPayload(
    await readJsonObject(request, { limitBytes: BODY_LIMIT_BYTES }),
  );
  const completedAtMs = Date.parse(payload.completedAt);
  if (
    Math.abs(Date.now() - completedAtMs) > COMPLETION_TIME_TOLERANCE_MS
  ) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_INTERVIEW_COMPLETION_EXPIRED",
      httpStatus: 400,
      message: "This environment answer is too old. Please try that topic again.",
    });
  }

  const eventId = `environment-interview:${payload.completionId}`;
  const envelope = buildHostedExecutionEnvironmentInterviewCompletedWake({
    completedAt: payload.completedAt,
    completionId: payload.completionId,
    eventId,
    memberId: auth.member.id,
    occurredAt: payload.completedAt,
    topics: payload.topics,
  });
  const prisma = getPrisma();
  const appended = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, auth.member.id);
    const member = await tx.hostedMember.findUnique({
      select: { suspendedAt: true },
      where: { id: auth.member.id },
    });
    if (!member || member.suspendedAt) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_ACCESS_INACTIVE",
        httpStatus: 403,
        message: "Your Murph access is not active.",
      });
    }
    return await appendHostedMailboxEnvelopeTx({ envelope, tx });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (appended.dedupeConflict) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_INTERVIEW_COMPLETION_CONFLICT",
      httpStatus: 409,
      message: "This environment answer conflicts with an earlier save.",
    });
  }

  await signalHostedMailboxAppendRuntime({
    expectedUserId: auth.member.id,
    mailboxItemId: appended.item.id,
  }).catch((error: unknown) => {
    console.warn("Environment fact was saved, but its runtime wake signal failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "ENVIRONMENT_INTERVIEW_TEMPORAL_SIGNAL_FAILED",
      }),
    });
  });

  return jsonOk({
    accepted: true,
    completionId: payload.completionId,
    duplicate: appended.duplicate,
  }, 202);
});
