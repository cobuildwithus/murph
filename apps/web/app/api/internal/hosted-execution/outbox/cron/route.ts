import { drainHostedExecutionOutbox } from "@/src/lib/hosted-execution/outbox";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const records = await drainHostedExecutionOutbox();

  return jsonOk({
    drained: records.length,
    eventIds: records.map((record) => record.eventId),
    statuses: records.map((record) => ({
      eventId: record.eventId,
      status: record.status,
    })),
  });
});
