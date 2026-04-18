import {
  readHostedWakeLifecycleState,
} from "@/src/lib/hosted-execution/wake-lifecycle";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
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

  const pendingWakeCount = countPendingWakes(cursor);
  const wakeState = eventId
    ? await readHostedWakeLifecycleState({
      eventId,
      prisma,
    })
    : undefined;

  return jsonOk({
    cursor,
    ...(wakeState === null || wakeState === undefined ? {} : { wakeState }),
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

function countPendingWakes(input: {
  committedSeq: string;
  nextSeq: string;
}): number {
  const pending = BigInt(input.nextSeq) - BigInt(input.committedSeq) - 1n;

  if (pending <= 0n) {
    return 0;
  }

  return pending > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(pending);
}
