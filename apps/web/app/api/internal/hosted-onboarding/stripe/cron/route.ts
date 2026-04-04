import { requireHostedExecutionSchedulerToken } from "@/src/lib/hosted-execution/internal";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  reconcileDueHostedStripeEvents,
  reconcileSubmittedHostedRevnetIssuances,
} from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import { drainHostedRevnetIssuanceSubmissionQueue } from "@/src/lib/hosted-onboarding/stripe-revnet-issuance";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
    requireHostedExecutionSchedulerToken(request);
    const prisma = getPrisma();
    const reconciledEventIds = await reconcileDueHostedStripeEvents({
      prisma,
    });
    const submittedIssuanceIds = await drainHostedRevnetIssuanceSubmissionQueue({
      prisma,
    });
    const confirmedIssuanceIds = await reconcileSubmittedHostedRevnetIssuances({
      prisma,
    });

    return jsonOk({
      confirmedIssuanceIds,
      reconciledEventIds,
      submittedIssuanceIds,
    });
});
