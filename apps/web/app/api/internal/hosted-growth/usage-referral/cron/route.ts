import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import {
  recoverPendingHostedUsageReferrals,
} from "@/src/lib/hosted-growth/usage-referral-recovery";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  return jsonOk({
    recovery: await recoverPendingHostedUsageReferrals(),
  });
});
