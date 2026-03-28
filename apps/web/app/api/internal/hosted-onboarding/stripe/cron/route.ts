import { requireHostedExecutionSchedulerToken } from "@/src/lib/hosted-execution/internal";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import {
  drainHostedStripeEventQueue,
  reconcileSubmittedHostedRevnetIssuances,
} from "@/src/lib/hosted-onboarding/stripe-event-queue";
import { drainHostedRevnetIssuanceSubmissionQueue } from "@/src/lib/hosted-onboarding/stripe-revnet-issuance";
import { getPrisma } from "@/src/lib/prisma";

export async function GET(request: Request) {
  try {
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

    return jsonOk({
      confirmedIssuanceIds,
      drainedEventIds,
      submittedIssuanceIds,
    });
  } catch (error) {
    return jsonError(error);
  }
}
