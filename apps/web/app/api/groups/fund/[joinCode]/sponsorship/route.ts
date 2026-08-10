import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  manageHostedGroupSponsorshipAuthorization,
  parseHostedGroupSponsorshipManagementAction,
  readHostedGroupSponsorshipManagementProjection,
} from "@/src/lib/hosted-groups/group-sponsorship-authorization";
import {
  normalizeHostedGroupUsageFundingLocator,
  readHostedGroupUsageFundingManagementTargetByLocator,
  readHostedGroupUsageFundingTargetByLocator,
} from "@/src/lib/hosted-groups/group-usage-funding";
import {
  recoverHostedGroupSponsorshipUsageCreditCheckout,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ joinCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const [body, rawJoinCode] = await Promise.all([
    readHostedOnboardingJsonObject(request, {
      limitBytes: BODY_LIMIT_BYTES,
      tooLargeErrorCode: "HOSTED_GROUP_SPONSORSHIP_MANAGEMENT_BODY_TOO_LARGE",
      tooLargeErrorMessage: "Monthly sponsorship request body is too large.",
    }),
    resolveDecodedRouteParam(context.params, "joinCode"),
  ]);
  const action = parseHostedGroupSponsorshipManagementAction(body);
  const locator = normalizeHostedGroupUsageFundingLocator(rawJoinCode);
  const prisma = getPrisma();
  const cancellationOnly = action.action === "cancel";
  if (!cancellationOnly) {
    assertHostedMemberNotSuspended(auth.member);
  }
  const target = locator
    ? cancellationOnly
      ? await readHostedGroupUsageFundingManagementTargetByLocator({
          locator,
          prisma,
        })
      : await readHostedGroupUsageFundingTargetByLocator({ locator, prisma })
    : null;
  if (!target) {
    return jsonOk({ management: null });
  }
  if (action.action === "recover") {
    const checkout =
      await recoverHostedGroupSponsorshipUsageCreditCheckout({
        authorizationId: action.authorizationId,
        beneficiaryMemberId: target.runtimeMemberId,
        payerMemberId: auth.member.id,
        prisma,
      });
    if (checkout) {
      return jsonOk({ checkout });
    }
    const management =
      await readHostedGroupSponsorshipManagementProjection({
        beneficiaryMemberId: target.runtimeMemberId,
        payerMemberId: auth.member.id,
        prisma,
      });
    return jsonOk({ management });
  }
  const management = await manageHostedGroupSponsorshipAuthorization({
    action,
    beneficiaryMemberId: target.runtimeMemberId,
    payerMemberId: auth.member.id,
    prisma,
  });
  return jsonOk({ management });
});
