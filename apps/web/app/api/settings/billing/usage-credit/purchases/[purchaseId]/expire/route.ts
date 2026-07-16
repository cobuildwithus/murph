import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { expireHostedUsageCreditCheckout } from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  const purchaseId = await resolveDecodedRouteParam(context.params, "purchaseId");
  const purchase = await expireHostedUsageCreditCheckout({
    payerMemberId: auth.member.id,
    prisma: getPrisma(),
    purchaseId,
  });

  return jsonOk(purchase);
});
