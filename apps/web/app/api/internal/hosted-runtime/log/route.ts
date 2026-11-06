import {
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  writeHostedRuntimeLogs,
} from "@/src/lib/hosted-runtime-log/write";

const HOSTED_RUNTIME_LOG_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  let userId: string;
  try {
    userId = await requireHostedCloudflareCallbackRequest(request, {
      maxBodyBytes: HOSTED_RUNTIME_LOG_CALLBACK_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (!isHostedOnboardingError(error)
      || error.code !== "HOSTED_RUNTIME_OWNER_STALE"
      || error.httpStatus !== 409) {
      throw error;
    }
    // Bounded shutdown drains can leave authenticated telemetry in flight after
    // retirement. Discard it before persistence.
    return jsonOk(parseHostedRuntimeLogResponse({ loggedCount: 0 }));
  }
  const body = parseHostedRuntimeLogRequest(await readOptionalJsonObject(request));

  const loggedCount = await writeHostedRuntimeLogs({
    entries: body.entries,
    userId,
  });

  return jsonOk(parseHostedRuntimeLogResponse({
    loggedCount,
  }));
});
