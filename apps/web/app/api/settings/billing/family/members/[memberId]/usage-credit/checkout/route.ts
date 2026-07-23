import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  createHostedFamilyMemberUsageCreditCheckout,
  parseHostedUsageCreditCheckoutRequest,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_USAGE_CREDIT_CHECKOUT_BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const [auth, body, beneficiaryMemberId] = await Promise.all([
    requireHostedAppSessionFromRequest(request),
    readHostedOnboardingJsonObject(request, {
      limitBytes: HOSTED_USAGE_CREDIT_CHECKOUT_BODY_LIMIT_BYTES,
      tooLargeErrorCode: "HOSTED_USAGE_CREDIT_CHECKOUT_BODY_TOO_LARGE",
      tooLargeErrorMessage: "Usage-credit checkout request body is too large.",
    }),
    resolveDecodedRouteParam(context.params, "memberId"),
  ]);
  assertHostedMemberNotSuspended(auth.member);
  const checkoutRequest = parseHostedUsageCreditCheckoutRequest(body);
  const checkout = await createHostedFamilyMemberUsageCreditCheckout({
    beneficiaryMemberId,
    clientRequestKey: checkoutRequest.clientRequestKey,
    offerCode: checkoutRequest.offerCode,
    payerMemberId: auth.member.id,
    prisma: getPrisma(),
  });

  return jsonOk(checkout);
});
