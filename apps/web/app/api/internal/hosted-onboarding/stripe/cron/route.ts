import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { drainHostedGroupJoinOutreachSweep } from "@/src/lib/hosted-groups/group-join-outreach-drain";
import { dispatchHostedGroupSponsorshipRefills } from "@/src/lib/hosted-groups/group-sponsorship-refill-dispatch";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { logHostedOnboardingDiagnostic } from "@/src/lib/hosted-onboarding/logging";
import { reconcileDueHostedStripeEvents } from "@/src/lib/hosted-onboarding/stripe-event-reconciliation";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const prisma = getPrisma();
  // This is the existing minute-level hosted-onboarding sweep. Pre-member
  // outreach cannot belong to a member runtime/system mailbox, and the hourly
  // contact-card sweep is too coarse for paced backlog drainage.
  const [groupJoinOutreach, groupSponsorshipRefills, reconciledEventIds] = await Promise.all([
    // Outreach shares this sweep, so its failure must not fail a
    // billing-critical cron. The drain owns durable deferral/retry state, so
    // the next invocation retries the same row; swallowing here only keeps
    // Stripe reconciliation's own outcome reportable.
    drainHostedGroupJoinOutreachSweep({
      prisma,
      signal: request.signal,
    }).catch((error: unknown) => {
      logHostedOnboardingDiagnostic("hosted-groups.join-outreach-drain", {
        kind: "cron_failed",
        reason: isHostedOnboardingError(error) ? error.code : "unhandled",
      });
      return { kind: "failed" as const };
    }),
    dispatchHostedGroupSponsorshipRefills({ prisma }).catch((error: unknown) => {
      logHostedOnboardingDiagnostic("hosted-groups.sponsorship-refill-dispatch", {
        kind: "cron_failed",
        reason: isHostedOnboardingError(error) ? error.code : "unhandled",
      });
      return { kind: "failed" as const };
    }),
    reconcileDueHostedStripeEvents({
      prisma,
    }),
  ]);

  return jsonOk({
    groupJoinOutreach,
    groupSponsorshipRefills,
    reconciledEventIds,
  });
});
