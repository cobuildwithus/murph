import { drainHostedExecutionOutbox } from "@/src/lib/hosted-execution/outbox";
import { requireHostedExecutionInternalToken } from "@/src/lib/hosted-execution/internal";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
    requireHostedExecutionInternalToken(request);
    const body = await readOptionalJsonObject(request);
    const eventIds = Array.isArray(body.eventIds)
      ? body.eventIds.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    const limit = typeof body.limit === "number" ? body.limit : undefined;
    const records = await drainHostedExecutionOutbox({
      eventIds,
      limit,
    });

    return jsonOk({
      drained: records.length,
      eventIds: records.map((record) => record.eventId),
      statuses: records.map((record) => ({
        eventId: record.eventId,
        status: record.status,
      })),
    });
});
