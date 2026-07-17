import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  createHostedUsageCreditCheckout,
  parseHostedUsageCreditCheckoutRequest,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_USAGE_CREDIT_CHECKOUT_BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_USAGE_CREDIT_CHECKOUT_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_USAGE_CREDIT_CHECKOUT_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Usage-credit checkout request body is too large.",
  });
  const checkoutRequest = parseHostedUsageCreditCheckoutRequest(body);
  const checkout = await createHostedUsageCreditCheckout({
    clientRequestKey: checkoutRequest.clientRequestKey,
    memberId: auth.member.id,
    offerCode: checkoutRequest.offerCode,
    prisma: getPrisma(),
  });

  return jsonOk(checkout);
});
