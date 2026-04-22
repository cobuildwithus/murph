import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedMemberStripeCustomerId,
} from "@/src/lib/hosted-onboarding/hosted-member-billing-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const stripeCustomerId = await readHostedMemberStripeCustomerId({
    memberId,
    prisma: getPrisma(),
  });

  return jsonOk({
    stripeCustomerId,
  });
});
