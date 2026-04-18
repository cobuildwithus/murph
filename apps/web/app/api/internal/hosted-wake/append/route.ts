import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  appendHostedExecutionWakePayloadTx,
} from "@/src/lib/hosted-wake/dispatch";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const wake = body.wake !== undefined
    ? parseHostedExecutionWake(body.wake)
    : (() => {
        throw new TypeError("Hosted wake append request must include wake.");
      })();

  if (wake.userId !== userId) {
    throw new TypeError("Hosted wake append wake userId must match the bound callback user.");
  }

  const response = await getPrisma().$transaction((tx) => {
    return appendHostedExecutionWakePayloadTx({
      wake,
      tx,
    });
  });

  return jsonOk(response);
});
