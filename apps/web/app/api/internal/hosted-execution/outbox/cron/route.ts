import {
  drainHostedExecutionOutbox,
  pruneHostedExecutionOutbox,
} from "@/src/lib/hosted-execution/outbox";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const records = await drainHostedExecutionOutbox();
  const pruned = await pruneHostedExecutionOutbox();

  const statusCounts = records.reduce<Record<string, number>>((counts, record) => {
    counts[record.status] = (counts[record.status] ?? 0) + 1;
    return counts;
  }, {});

  return jsonOk({
    drained: records.length,
    pruned,
    statusCounts,
  });
});
