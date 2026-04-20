import { parseHostedWakeCommitRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  commitHostedExecutionCursorTx,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedWakeCommitRequest(await readOptionalJsonObject(request));
  const assistantNextWakeAt = "assistantNextWakeAt" in body ? body.assistantNextWakeAt ?? null : undefined;
  const nextRuntimeWakeAt = "nextRuntimeWakeAt" in body ? body.nextRuntimeWakeAt ?? null : undefined;
  const nextRuntimeWakeReason = "nextRuntimeWakeReason" in body ? body.nextRuntimeWakeReason ?? null : undefined;
  const committedSeq = BigInt(body.committedSeq);
  const expectedVersion = BigInt(body.expectedVersion);
  const snapshotRef = "snapshotRef" in body ? body.snapshotRef ?? null : undefined;
  const response = await getPrisma().$transaction((tx) => {
    return commitHostedExecutionCursorTx({
      assistantNextWakeAt,
      committedSeq,
      expectedVersion,
      nextRuntimeWakeAt,
      nextRuntimeWakeReason,
      snapshotRef,
      tx,
      userId,
    });
  });

  return jsonOk(response);
});
