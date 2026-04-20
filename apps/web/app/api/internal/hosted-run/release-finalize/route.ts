import { parseHostedRunReleaseFinalizeRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { releaseHostedRunFinalize } from "@/src/lib/hosted-run/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunReleaseFinalizeRequest(await readOptionalJsonObject(request));
  const response = await releaseHostedRunFinalize({
    failureClass: "failureClass" in body ? body.failureClass ?? null : undefined,
    failureCode: "failureCode" in body ? body.failureCode ?? null : undefined,
    runId: body.runId,
    runToken: body.runToken,
    userId,
  });

  return jsonOk(response);
});
