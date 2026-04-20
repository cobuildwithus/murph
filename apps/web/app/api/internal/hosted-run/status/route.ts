import { parseHostedRunStatusRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedRunStatus } from "@/src/lib/hosted-run/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunStatusRequest(await readOptionalJsonObject(request));
  const response = await readHostedRunStatus({
    includeLogs: body.includeLogs,
    limit: body.limit,
    runId: body.runId,
    userId,
  });

  return jsonOk(response);
});
