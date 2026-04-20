import { parseHostedRunAcquireRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { acquireHostedRun } from "@/src/lib/hosted-run/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRunAcquireRequest(await readOptionalJsonObject(request));
  const now = body.now ? new Date(body.now) : undefined;

  if (now && Number.isNaN(now.getTime())) {
    throw new TypeError("Hosted run acquire request now must be a valid ISO-8601 timestamp.");
  }

  const response = await acquireHostedRun({
    executorKind: body.executorKind,
    executorCodeDigest: body.executorCodeDigest,
    attestationRef: body.attestationRef,
    signedResultRef: body.signedResultRef,
    limit: body.limit,
    now,
    triggerKind: body.triggerKind,
    userId,
  });

  return jsonOk(response);
});
