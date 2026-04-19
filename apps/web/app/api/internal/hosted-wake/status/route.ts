import { parseHostedWakeStatusRequest } from "@murphai/hosted-execution/parsers";

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
  validateHostedWakeFetchProofCurrent,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedWakeStatusRequest(await readOptionalJsonObject(request));
  const eventId = body.eventId ?? body.wakeEventId ?? null;
  const prisma = getPrisma();
  const fetchProofStatus = body.fetchProof && body.wakeEventId && body.wakeId && body.wakeSeq
    ? await validateHostedWakeFetchProofCurrent({
      fetchProof: body.fetchProof,
      prisma,
      userId,
      wakeEventId: body.wakeEventId,
      wakeId: body.wakeId,
      wakeSeq: BigInt(body.wakeSeq),
    })
    : null;
  const cursor = fetchProofStatus?.cursor ?? await readHostedExecutionCursor({
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
    ...(fetchProofStatus === null ? {} : {
      fetchProofCurrent: fetchProofStatus.fetchProofCurrent,
    }),
    ...(wakeLifecycle?.replacedByEventId
      ? {
          replacedByEventId: wakeLifecycle.replacedByEventId,
        }
      : {}),
    ...(wakeLifecycle?.state === undefined ? {} : { wakeState: wakeLifecycle.state }),
    pendingWakeCount,
  });
});
