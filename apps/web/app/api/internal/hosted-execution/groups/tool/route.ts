import {
  parseHostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/parsers";

import {
  handleHostedRuntimeGroupTool,
} from "@/src/lib/hosted-groups/group-tool";
import {
  filterHostedRuntimeGroupToolResponseProjectionScopes,
} from "@/src/lib/hosted-groups/group-tool-scope-filter";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  readHostedVaultShareSupportedProjectionScopeKeysFromRequest,
} from "@/src/lib/hosted-vault-share/supported-projection-scopes";
import { readRawBodyBuffer } from "@/src/lib/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8_192;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedRuntimeGroupToolRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  const supportedProjectionScopeKeys =
    readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request);

  return jsonOk(filterHostedRuntimeGroupToolResponseProjectionScopes(
    await handleHostedRuntimeGroupTool({
      memberId,
      request: body,
    }),
    supportedProjectionScopeKeys,
  ));
});
