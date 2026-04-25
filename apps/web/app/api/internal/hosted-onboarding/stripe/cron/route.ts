import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { reconcileDueHostedStripeEvents } from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const prisma = getPrisma();
  const reconciledEventIds = await reconcileDueHostedStripeEvents({
    prisma,
  });

  return jsonOk({
    reconciledEventIds,
  });
});
