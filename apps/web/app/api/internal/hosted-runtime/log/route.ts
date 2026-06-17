import {
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "@/src/lib/hosted-execution/logging";
import {
  signalHostedRuntimeRecheckRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  readAcceptedRuntimeAttemptFailureSignalOwnerLogId,
  recordHostedRuntimeLog,
  type HostedRuntimeLogRecord,
} from "@/src/lib/hosted-workspace/store";

const ACCEPTED_RUNTIME_ATTEMPT_FAILED_EVENT_CODE = "runner.accepted_attempt_failed";
const ACCEPTED_RUNTIME_ATTEMPT_RECHECK_COOLDOWN_MS = 30_000;
const HOSTED_RUNTIME_LOG_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_LOG_CALLBACK_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeLogRequest(await readOptionalJsonObject(request));

  const records = await Promise.all(body.entries.map((entry) => recordHostedRuntimeLog({
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

  await signalAcceptedRuntimeAttemptFailureBestEffort({
    records,
    userId,
  });

  return jsonOk(parseHostedRuntimeLogResponse({
    loggedCount: body.entries.length,
  }));
});

async function signalAcceptedRuntimeAttemptFailureBestEffort(input: {
  records: readonly HostedRuntimeLogRecord[];
  userId: string;
}): Promise<void> {
  const acceptedFailureLogIds = input.records
    .filter((record) => record.eventCode === ACCEPTED_RUNTIME_ATTEMPT_FAILED_EVENT_CODE)
    .map((record) => record.id);
  if (acceptedFailureLogIds.length === 0) {
    return;
  }

  try {
    const signalOwnerLogId = await readAcceptedRuntimeAttemptFailureSignalOwnerLogId({
      since: new Date(Date.now() - ACCEPTED_RUNTIME_ATTEMPT_RECHECK_COOLDOWN_MS),
      userId: input.userId,
    });
    if (
      signalOwnerLogId === null
      || !acceptedFailureLogIds.includes(signalOwnerLogId)
    ) {
      return;
    }

    await signalHostedRuntimeRecheckRuntime({
      userId: input.userId,
    });
  } catch (error) {
    console.warn(
      "Hosted runtime recheck signal failed after accepted-attempt failure log.",
      {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_RUNTIME_RECHECK_SIGNAL_FAILED",
        }),
      },
    );
  }
}
