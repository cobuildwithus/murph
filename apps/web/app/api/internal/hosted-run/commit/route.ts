import { parseHostedRunCommitRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { commitHostedRun } from "@/src/lib/hosted-run/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunCommitRequest(await readOptionalJsonObject(request));
  const response = await commitHostedRun({
    eventResults: body.eventResults,
    expectedCursorVersion: BigInt(body.expectedCursorVersion),
    failureClass: "failureClass" in body ? body.failureClass ?? null : undefined,
    failureCode: "failureCode" in body ? body.failureCode ?? null : undefined,
    finalizeRequired: body.finalizeRequired,
    nextRuntimeWakeAt: "nextRuntimeWakeAt" in body ? body.nextRuntimeWakeAt ?? null : undefined,
    nextRuntimeWakeReason: "nextRuntimeWakeReason" in body ? body.nextRuntimeWakeReason ?? null : undefined,
    outputCommittedSeq: BigInt(body.outputCommittedSeq),
    preparedSnapshotRef: "preparedSnapshotRef" in body ? body.preparedSnapshotRef ?? null : undefined,
    redactedSummary: "redactedSummary" in body ? body.redactedSummary ?? null : undefined,
    runId: body.runId,
    runToken: body.runToken,
    userId,
  });

  return jsonOk(response);
});
