import { drainHostedExecutionOutbox } from "@/src/lib/hosted-execution/outbox";
import { requireHostedExecutionInternalToken } from "@/src/lib/hosted-execution/internal";
import { jsonError, jsonOk, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    return jsonError(error);
  }
}
