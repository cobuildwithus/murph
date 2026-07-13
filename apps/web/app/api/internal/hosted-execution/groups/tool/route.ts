import {
  parseHostedRuntimeGroupToolRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_GROUP_JOIN_OFFER_EFFECT_ID_PARAM,
} from "@murphai/hosted-execution/routes";

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
const JOIN_OFFER_EFFECT_ID_PATTERN = /^group_join_offer_[a-f0-9]{64}$/u;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const parsedBody = parseHostedRuntimeGroupToolRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  const body = parsedBody.action === "post_join_offer"
    ? { ...parsedBody, effectId: readJoinOfferEffectId(request) }
    : parsedBody;
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

function readJoinOfferEffectId(request: Request): string | null {
  const values = new URL(request.url).searchParams
    .getAll(HOSTED_RUNTIME_GROUP_JOIN_OFFER_EFFECT_ID_PARAM);
  if (values.length !== 1) {
    return null;
  }
  const effectId = values[0]?.trim() ?? "";
  return JOIN_OFFER_EFFECT_ID_PATTERN.test(effectId) ? effectId : null;
}
