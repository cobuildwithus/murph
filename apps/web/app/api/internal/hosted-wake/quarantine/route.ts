import { parseHostedWakeQuarantineRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  quarantineHostedWakeTx,
} from "@/src/lib/hosted-wake/store";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedWakeQuarantineRequest(await readOptionalJsonObject(request));
  const quarantined = await getPrisma().$transaction((tx) => {
    return quarantineHostedWakeTx({
      fetchProof: body.fetchProof,
      quarantineCode: body.quarantineCode,
      tx,
      userId,
      wakeId: body.wakeId,
      wakeSeq: BigInt(body.wakeSeq),
    });
  });

  return jsonOk({ quarantined });
});
