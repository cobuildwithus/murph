import { parseHostedRunTurnInputAdoptRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { adoptHostedRunTurnInput } from "@/src/lib/hosted-run/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunTurnInputAdoptRequest(await readOptionalJsonObject(request));
  const response = await adoptHostedRunTurnInput({
    afterSeq: body.afterSeq === undefined || body.afterSeq === null
      ? null
      : BigInt(body.afterSeq),
    ingressEventIds: body.ingressEventIds,
    runId: body.runId,
    runToken: body.runToken,
    userId,
  });

  return jsonOk(response);
});
