import { requireHostedExecutionSchedulerToken } from "@/src/lib/hosted-execution/internal";
import { drainHostedActivationWelcomeMessages } from "@/src/lib/hosted-onboarding/activation-welcome";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  drainHostedStripeEventQueue,
  reconcileSubmittedHostedRevnetIssuances,
} from "@/src/lib/hosted-onboarding/stripe-event-queue";
import { drainHostedRevnetIssuanceSubmissionQueue } from "@/src/lib/hosted-onboarding/stripe-revnet-issuance";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
    requireHostedExecutionSchedulerToken(request);
    const prisma = getPrisma();
    const drainedEventIds = await drainHostedStripeEventQueue({
      prisma,
    });
    const submittedIssuanceIds = await drainHostedRevnetIssuanceSubmissionQueue({
      prisma,
    });
    const confirmedIssuanceIds = await reconcileSubmittedHostedRevnetIssuances({
      prisma,
    });
    const welcomedMemberIds = await drainHostedActivationWelcomeMessages({
      prisma,
    });

    return jsonOk({
      confirmedIssuanceIds,
      drainedEventIds,
      submittedIssuanceIds,
      welcomedMemberIds,
    });
});
