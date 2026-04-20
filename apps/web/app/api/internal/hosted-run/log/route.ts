import { parseHostedRunLogRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { recordHostedRunLog } from "@/src/lib/hosted-run/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunLogRequest(await readOptionalJsonObject(request));
  const at = body.at ? new Date(body.at) : undefined;

  if (at && Number.isNaN(at.getTime())) {
    throw new TypeError("Hosted run log request at must be a valid ISO-8601 timestamp.");
  }

  const response = await recordHostedRunLog({
    at,
    component: body.component,
    level: body.level,
    message: body.message,
    phase: body.phase,
    redacted: "redacted" in body ? body.redacted ?? null : undefined,
    runId: body.runId,
    runToken: body.runToken,
    userId,
  });

  return jsonOk(response);
});
