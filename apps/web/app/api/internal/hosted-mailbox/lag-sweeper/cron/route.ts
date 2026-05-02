import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { runHostedMailboxLagSweeper } from "@/src/lib/hosted-mailbox/lag-sweeper";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const sweeper = await runHostedMailboxLagSweeper();

  return jsonOk({
    sweeper,
  });
});
