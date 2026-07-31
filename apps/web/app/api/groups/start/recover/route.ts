import {
  demoteHostedMemberLinqGroupChatBindingsTx,
  readHostedMemberRoutingState,
  upsertHostedMemberPendingLinqBindingTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  openHostedLinqGroupEmailRecoveryToken,
} from "@/src/lib/hosted-onboarding/linq-group-setup";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import {
  readHostedThreadRouteByThreadIdentity,
} from "@/src/lib/hosted-routing/thread-route-store";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8_192;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(session.member);

  const body = await readOptionalJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
  });
  const token = readRecoveryToken(body.token);
  const recovery = openHostedLinqGroupEmailRecoveryToken({ token });
  if (!recovery) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 410,
      message: "That Messages recovery link is invalid or expired.",
      retryable: false,
    });
  }

  const prisma = getPrisma();
  const status = await prisma.$transaction(async (tx) => {
    const routeBefore = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: tx,
      threadId: recovery.chatId,
    });
    if (routeBefore) {
      return "already_connected" as const;
    }

    const routing = await readHostedMemberRoutingState({
      memberId: session.member.id,
      prisma: tx,
    });
    if (
      routing?.pendingLinqChatId
      && routing.pendingLinqChatId !== recovery.chatId
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_CONFLICT",
        httpStatus: 409,
        message:
          "This Murph account is already finishing another Messages connection.",
        retryable: false,
      });
    }

    await upsertHostedMemberPendingLinqBindingTx({
      homeLineAssignedAt: null,
      linqChatId: recovery.chatId,
      memberId: session.member.id,
      participantContact: recovery.participantContact,
      participantContactObservedAt: recovery.observedAt,
      prisma: tx,
      recipientPhone: recovery.recipientPhone,
    });

    const routeAfter = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: tx,
      threadId: recovery.chatId,
    });
    if (routeAfter) {
      await demoteHostedMemberLinqGroupChatBindingsTx({
        linqChatId: recovery.chatId,
        prisma: tx,
      });
      return "already_connected" as const;
    }

    return "linked" as const;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return jsonOk({
    ok: true,
    status,
  });
});

function readRecoveryToken(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 6_000
    || value !== value.trim()
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_EMAIL_RECOVERY_INVALID",
      httpStatus: 400,
      message: "A valid Messages recovery link is required.",
      retryable: false,
    });
  }
  return value;
}
