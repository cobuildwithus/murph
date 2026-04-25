import { parseHostedRunFinalizeRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { finalizeHostedRun } from "@/src/lib/hosted-run/store";
import { markHostedVaultSyncSessionCommittedFromRunSummary } from "@/src/lib/vault-sync/session-service";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunFinalizeRequest(await readOptionalJsonObject(request));
  const response = await finalizeHostedRun({
    browserVaultReplicaRef: "browserVaultReplicaRef" in body ? body.browserVaultReplicaRef ?? null : undefined,
    finalSnapshotRef: body.finalSnapshotRef,
    nextRuntimeWakeAt: "nextRuntimeWakeAt" in body ? body.nextRuntimeWakeAt ?? null : undefined,
    nextRuntimeWakeReason: "nextRuntimeWakeReason" in body ? body.nextRuntimeWakeReason ?? null : undefined,
    redactedSummary: "redactedSummary" in body ? body.redactedSummary ?? null : undefined,
    runId: body.runId,
    runToken: body.runToken,
    userId,
  });

  if (response.finalized && response.run) {
    try {
      await markHostedVaultSyncSessionCommittedFromRunSummary({
        memberId: userId,
        redactedSummary: response.run.redactedSummary,
      });
    } catch {
      console.warn("Failed to update hosted vault sync session status after run finalize.");
    }
  }

  return jsonOk(response);
});
