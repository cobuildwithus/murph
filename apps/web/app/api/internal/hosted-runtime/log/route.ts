import {
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { recordHostedRuntimeLog } from "@/src/lib/hosted-workspace/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRuntimeLogRequest(await readOptionalJsonObject(request));

  await Promise.all(body.entries.map((entry) => recordHostedRuntimeLog({
    at: entry.at,
    component: entry.component,
    eventCode: entry.eventCode,
    level: entry.level,
    phase: entry.phase,
    userId,
    ...("attemptId" in entry ? { attemptId: entry.attemptId } : {}),
    ...("checkpointVersion" in entry ? { checkpointVersion: entry.checkpointVersion } : {}),
    ...("errorCode" in entry ? { errorCode: entry.errorCode } : {}),
    ...("leaseGeneration" in entry ? { leaseGeneration: entry.leaseGeneration } : {}),
    ...("mailboxLane" in entry ? { mailboxLane: entry.mailboxLane } : {}),
    ...("mailboxSeqEnd" in entry ? { mailboxSeqEnd: entry.mailboxSeqEnd } : {}),
    ...("mailboxSeqStart" in entry ? { mailboxSeqStart: entry.mailboxSeqStart } : {}),
    ...("outboxIntentRef" in entry ? { outboxIntentRef: entry.outboxIntentRef } : {}),
    ...("redactedJson" in entry ? { redacted: entry.redactedJson } : {}),
    ...("workspaceVersion" in entry ? { workspaceVersion: entry.workspaceVersion } : {}),
  })));

  return jsonOk(parseHostedRuntimeLogResponse({
    loggedCount: body.entries.length,
  }));
});
