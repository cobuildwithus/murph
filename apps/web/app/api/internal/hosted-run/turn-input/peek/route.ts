import { parseHostedRunTurnInputPeekRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { peekHostedRunTurnInput } from "@/src/lib/hosted-run/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunTurnInputPeekRequest(await readOptionalJsonObject(request));
  const response = await peekHostedRunTurnInput({
    afterSeq: body.afterSeq === undefined || body.afterSeq === null
      ? null
      : BigInt(body.afterSeq),
    limit: body.limit,
    runId: body.runId,
    runToken: body.runToken,
    userId,
  });

  return jsonOk(response);
});
