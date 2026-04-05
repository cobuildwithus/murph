import { drainHostedExecutionOutbox } from "@/src/lib/hosted-execution/outbox";
import {
  HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID,
  requireHostedWebInternalServiceRequest,
} from "@/src/lib/hosted-execution/internal";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  await requireHostedWebInternalServiceRequest(request, HOSTED_WEB_INTERNAL_SCHEDULER_USER_ID);
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
