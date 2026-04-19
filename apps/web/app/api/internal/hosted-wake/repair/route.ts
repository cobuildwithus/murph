import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { nudgeHostedWakeUserBestEffort } from "@/src/lib/hosted-wake/control";
import { listHostedWakeRepairCandidates } from "@/src/lib/hosted-wake/store";

const HOSTED_WAKE_REPAIR_STALE_MS = 60_000;
const HOSTED_WAKE_REPAIR_BATCH_LIMIT = 128;

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const candidates = await listHostedWakeRepairCandidates({
    limit: HOSTED_WAKE_REPAIR_BATCH_LIMIT,
    olderThan: new Date(Date.now() - HOSTED_WAKE_REPAIR_STALE_MS),
  });

  let nudged = 0;

  for (const candidate of candidates) {
    const woke = await nudgeHostedWakeUserBestEffort({
      context: "hosted-wake.repair",
      userId: candidate.userId,
    });

    if (woke) {
      nudged += 1;
    }
  }

  return jsonOk({
    examined: candidates.length,
    nudged,
    staleAfterMs: HOSTED_WAKE_REPAIR_STALE_MS,
  });
});
