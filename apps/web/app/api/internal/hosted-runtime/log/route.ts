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
  writeHostedRuntimeLogs,
} from "@/src/lib/hosted-runtime-log/write";
import {
  claimHostedAcceptedAttemptFailureRecheck,
} from "@/src/lib/hosted-workspace/store";

const ACCEPTED_RUNTIME_ATTEMPT_FAILED_EVENT_CODE = "runner.accepted_attempt_failed";
const ACCEPTED_RUNTIME_ATTEMPT_RECHECK_COOLDOWN_MS = 30_000;
const HOSTED_RUNTIME_LOG_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_LOG_CALLBACK_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeLogRequest(await readOptionalJsonObject(request));

  // Recovery runs before persistence, not after it: a failed diagnostic insert
  // must not cost an accepted attempt its recheck. The signal helper swallows
  // its own failures, so neither direction can break the other.
  if (
    body.entries.some((entry) =>
      entry.eventCode === ACCEPTED_RUNTIME_ATTEMPT_FAILED_EVENT_CODE
    )
  ) {
    await signalAcceptedRuntimeAttemptFailureBestEffort({ userId });
  }

  const loggedCount = await writeHostedRuntimeLogs({
    entries: body.entries,
    userId,
  });

  return jsonOk(parseHostedRuntimeLogResponse({
    loggedCount,
  }));
});

async function signalAcceptedRuntimeAttemptFailureBestEffort(input: {
  userId: string;
}): Promise<void> {
  try {
    const claimed = await claimHostedAcceptedAttemptFailureRecheck({
      cooldownMs: ACCEPTED_RUNTIME_ATTEMPT_RECHECK_COOLDOWN_MS,
      userId: input.userId,
    });
    if (!claimed) {
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
