import {
  parseHostedMailboxConsumeRequest,
  parseHostedMailboxConsumeResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  requireHostedRuntimeMailboxActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  advanceHostedMailboxConsumedSeqByLane,
} from "@/src/lib/hosted-mailbox/store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_MAILBOX_CONSUME_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

// Advances the per-lane consumed watermark after a runtime pass finished
// handling the staged mailbox prefix. Replay after a workspace restore treats
// items at or below this watermark as context only, never as fresh reply
// candidates. The advance is a monotonic max, so duplicate or late acks are
// harmless no-ops.
export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_MAILBOX_CONSUME_CALLBACK_BODY_LIMIT_BYTES,
  });
  await requireHostedRuntimeMailboxActiveAccess(userId);
  const body = parseHostedMailboxConsumeRequest(await readOptionalJsonObject(request));
  const consumedSeqByLane = await advanceHostedMailboxConsumedSeqByLane({
    lanes: body.lanes,
    userId,
  });

  return jsonOk(parseHostedMailboxConsumeResponse({
    acknowledgedAt: new Date().toISOString(),
    consumedSeqByLane,
    userId,
  }));
});
