import { parseHostedRuntimeVaultSyncImportRequest } from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { recordHostedVaultSyncImportResult } from "@/src/lib/vault-sync/session-service";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRuntimeVaultSyncImportRequest(await readOptionalJsonObject(request));
  const result = await recordHostedVaultSyncImportResult({
    memberId,
    request: body,
  });

  return jsonOk(result);
});
