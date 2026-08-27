import {
  parseHostedOperatorTaskControlRequest,
} from "@murphai/hosted-execution";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedOperatorMessageControl,
} from "@/src/lib/hosted-ops/operator-task";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 8 * 1_024;

export const POST = withJsonError(async (request: Request) => {
  const boundRuntimeMemberId = await requireHostedCloudflareCallbackRequest(
    request,
    { maxBodyBytes: BODY_LIMIT_BYTES },
  );
  return jsonOk(await handleHostedOperatorMessageControl({
    boundRuntimeMemberId,
    request: parseHostedOperatorTaskControlRequest(
      await readOptionalJsonObject(request),
    ),
  }));
});
