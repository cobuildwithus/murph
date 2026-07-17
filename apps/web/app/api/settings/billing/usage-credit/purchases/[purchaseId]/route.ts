import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedUsageCreditPurchaseStatus } from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) => {
  const auth = await requireHostedAppSessionFromRequest(request);
  const purchaseId = await resolveDecodedRouteParam(context.params, "purchaseId");
  const purchase = await readHostedUsageCreditPurchaseStatus({
    payerMemberId: auth.member.id,
    prisma: getPrisma(),
    purchaseId,
  });

  return jsonOk(purchase);
});
