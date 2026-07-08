import { resolveDecodedRouteParam } from "@/src/lib/http";
import { readHostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  acceptHostedFamilyInvite,
  readHostedFamilyInviteAcceptanceView,
} from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedMemberIdentity } from "@/src/lib/hosted-onboarding/hosted-member-identity-store";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ inviteCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const inviteCode = await resolveDecodedRouteParam(context.params, "inviteCode");

  const view = await readHostedFamilyInviteAcceptanceView({ inviteCode, prisma });
  if (!view) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_NOT_FOUND",
      httpStatus: 404,
      message: "That family invite is no longer valid.",
    });
  }
  if (view.status !== "pending" && view.status !== "accepted") {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_NOT_ACTIVE",
      httpStatus: 410,
      message: "That family invite has expired or was already used.",
    });
  }
  if (view.status === "pending") {
    if (!view.groupActive) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_GROUP_INACTIVE",
        httpStatus: 409,
        message: "This family plan isn't active right now. Ask the plan owner to finish setting it up.",
      });
    }
    if (!view.isPhoneBound && !view.isEmailBound && view.isTelegramBound) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_WEB_ACCEPT_REQUIRES_CONTACT",
        httpStatus: 409,
        message: "Open this invite from Telegram or WhatsApp to join.",
      });
    }
    if (!view.seatAvailable) {
      throw hostedOnboardingError({
        code: "HOSTED_FAMILY_SEAT_LIMIT_REACHED",
        httpStatus: 409,
        message: "This family plan already has four active or invited people.",
      });
    }
  }

  const [identity, account] = await Promise.all([
    readHostedMemberIdentity({ memberId: auth.member.id, prisma }),
    readHostedAccountSettingsSnapshot({ memberId: auth.member.id }),
  ]);

  await acceptHostedFamilyInvite({
    acceptedMemberId: auth.member.id,
    email: account.email.verifiedAt ? account.email.address : null,
    inviteCode,
    phoneNumber: identity?.phoneNumber ?? null,
    prisma,
    requireWebBinding: true,
  });

  return jsonOk({ accepted: true });
});
