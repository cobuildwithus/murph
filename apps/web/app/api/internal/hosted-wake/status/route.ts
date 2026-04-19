import {
  readHostedWakeLifecycle,
} from "@/src/lib/hosted-wake/lifecycle";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  countPendingHostedWakes,
  readHostedExecutionCursor,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const eventId = readOptionalEventId(body.eventId);
  const prisma = getPrisma();
  const cursor = await readHostedExecutionCursor({
    prisma,
    userId,
  });
  const pendingWakeCount = await countPendingHostedWakes({
    prisma,
    userId,
  });
  const wakeLifecycle = eventId
    ? await readHostedWakeLifecycle({
      eventId,
      prisma,
      userId,
    })
    : undefined;

  return jsonOk({
    cursor,
    ...(wakeLifecycle?.replacedByEventId
      ? {
          replacedByEventId: wakeLifecycle.replacedByEventId,
        }
      : {}),
    ...(wakeLifecycle?.state === undefined ? {} : { wakeState: wakeLifecycle.state }),
    pendingWakeCount,
  });
});

function readOptionalEventId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError("eventId must be a string.");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
