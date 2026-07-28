import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  createHostedGroupUsageCreditCheckout,
  parseHostedGroupSponsorshipCheckoutRequest,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_GROUP_USAGE_CREDIT_CHECKOUT_BODY_LIMIT_BYTES = 4_096;

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ joinCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const [body, joinCode] = await Promise.all([
    readHostedOnboardingJsonObject(request, {
      limitBytes: HOSTED_GROUP_USAGE_CREDIT_CHECKOUT_BODY_LIMIT_BYTES,
      tooLargeErrorCode: "HOSTED_USAGE_CREDIT_CHECKOUT_BODY_TOO_LARGE",
      tooLargeErrorMessage: "Usage-credit checkout request body is too large.",
    }),
    resolveDecodedRouteParam(context.params, "joinCode"),
  ]);
  const checkoutRequest = parseHostedGroupSponsorshipCheckoutRequest(body);
  const checkout = await createHostedGroupUsageCreditCheckout({
    clientRequestKey: checkoutRequest.clientRequestKey,
    joinCode,
    offerCode: checkoutRequest.offerCode,
    payerMemberId: auth.member.id,
    prisma: getPrisma(),
    sponsorship: checkoutRequest.sponsorship,
  });

  return jsonOk(checkout);
});
