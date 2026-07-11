import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  createHostedBillingPortalSession,
} from "@/src/lib/hosted-onboarding/billing-portal-service";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readOptionalJsonObject(request, { limitBytes: 1_024 });
  const billingScope = body.billingScope === "family" ? "family" : "member";
  return jsonOk(await createHostedBillingPortalSession({
    billingScope,
    memberId: auth.member.id,
    prisma,
    returnUrl: new URL("/settings", request.url).toString(),
  }));
});
