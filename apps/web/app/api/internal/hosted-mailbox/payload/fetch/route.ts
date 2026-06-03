import {
  parseHostedMailboxPayloadFetchRequest,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { fetchHostedMailboxPayload } from "@/src/lib/hosted-mailbox/store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_MAILBOX_PAYLOAD_FETCH_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_MAILBOX_PAYLOAD_FETCH_CALLBACK_BODY_LIMIT_BYTES,
  });
  const body = parseHostedMailboxPayloadFetchRequest(await readOptionalJsonObject(request));
  const response = await fetchHostedMailboxPayload({
    dedupeKey: body.dedupeKey,
    mailboxItemId: body.mailboxItemId,
    ...("payloadRef" in body ? { payloadRef: body.payloadRef } : {}),
    requestId: body.requestId,
    userId,
  });

  return jsonOk(parseHostedMailboxPayloadFetchResponse(response));
});
