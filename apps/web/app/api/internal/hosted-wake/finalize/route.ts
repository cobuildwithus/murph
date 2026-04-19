import { parseHostedWakeFinalizeRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  finalizeHostedExecutionCursorTx,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedWakeFinalizeRequest(await readOptionalJsonObject(request));
  const response = await getPrisma().$transaction((tx) => {
    return finalizeHostedExecutionCursorTx({
      assistantNextWakeAt: "assistantNextWakeAt" in body ? body.assistantNextWakeAt ?? null : undefined,
      finalizeToken: body.finalizeToken,
      snapshotRef: body.snapshotRef,
      tx,
      userId,
    });
  });

  return jsonOk(response);
});
