import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { readHostedOnboardingEnvironment } from "@/src/lib/hosted-onboarding/env";
import {
  buildHostedFamilyInviteAcceptUrl,
  buildHostedFamilyTelegramInviteUrl,
  ensureHostedAccountGroupForOwnerTx,
  issueHostedFamilyInviteTx,
} from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const body = await readOptionalJsonObject(request, { limitBytes: 2_048 });
  const targetLabel = typeof body.targetLabel === "string" ? body.targetLabel : null;
  const targetEmail = typeof body.targetEmail === "string" ? body.targetEmail : null;
  const targetPhoneNumber =
    typeof body.targetPhoneNumber === "string" ? body.targetPhoneNumber : null;
  const targetTelegramUsername =
    typeof body.targetTelegramUsername === "string" ? body.targetTelegramUsername : null;

  if (!targetPhoneNumber && !targetTelegramUsername && !targetEmail && !targetLabel) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_TARGET_REQUIRED",
      httpStatus: 400,
      message: "Add a phone number, email, Telegram username, or name for the person you are inviting.",
    });
  }

  const invite = await prisma.$transaction(async (tx) => {
    const group = await ensureHostedAccountGroupForOwnerTx({
      ownerMemberId: auth.member.id,
      tx,
    });
    return issueHostedFamilyInviteTx({
      groupId: group.id,
      invitedByMemberId: auth.member.id,
      targetEmail,
      targetLabel,
      targetPhoneNumber,
      targetTelegramUsername,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  const { publicBaseUrl, telegramBotUsername } = readHostedOnboardingEnvironment();

  return jsonOk({
    invite: {
      acceptUrl: buildHostedFamilyInviteAcceptUrl({
        inviteCode: invite.inviteCode,
        publicBaseUrl,
      }),
      channel: invite.channel,
      expiresAt: invite.expiresAt.toISOString(),
      id: invite.id,
      status: invite.status,
      targetLabel: invite.targetLabel,
      targetPhoneHint: invite.targetPhoneHint,
      telegramInviteUrl: telegramBotUsername
        ? buildHostedFamilyTelegramInviteUrl({
            botUsername: telegramBotUsername,
            inviteCode: invite.inviteCode,
          })
        : null,
    },
  });
});
