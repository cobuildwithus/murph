import { Buffer } from "node:buffer";

import {
  buildHostedExecutionEmailConversationMessageWake,
  parseHostedEmailIngressWakeAppendRequest,
} from "@murphai/hosted-execution";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  appendHostedMailboxEnvelopeTx,
} from "@/src/lib/hosted-mailbox/store";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readOptionalJsonObject, readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_EMAIL_INGRESS_CALLBACK_MAX_BODY_BYTES = 16 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const boundedRequest = await readBoundedHostedEmailIngressRequest(request);
  const userId = await requireHostedCloudflareCallbackRequest(boundedRequest, {
    maxBodyBytes: HOSTED_EMAIL_INGRESS_CALLBACK_MAX_BODY_BYTES,
  });
  const body = parseHostedEmailIngressWakeAppendRequest(await readOptionalJsonObject(boundedRequest));
  const envelope = buildHostedExecutionEmailConversationMessageWake({
    ...(body.attachmentSummaries === undefined ? {} : { attachmentSummaries: body.attachmentSummaries }),
    ...(body.cc === undefined ? {} : { cc: body.cc }),
    eventId: body.eventId,
    ...(body.from === undefined ? {} : { from: body.from }),
    identityId: body.identityId,
    ...(body.messageId === undefined ? {} : { messageId: body.messageId }),
    occurredAt: body.occurredAt,
    rawMessageKey: body.rawMessageKey,
    ...(body.selfAddress === undefined ? {} : { selfAddress: body.selfAddress }),
    ...(body.subject === undefined ? {} : { subject: body.subject }),
    ...(body.textPreview === undefined ? {} : { textPreview: body.textPreview }),
    ...(body.threadKey === undefined ? {} : { threadKey: body.threadKey }),
    ...(body.threadTarget === undefined ? {} : { threadTarget: body.threadTarget }),
    ...(body.to === undefined ? {} : { to: body.to }),
    userId,
  });

  const response = await getPrisma().$transaction((tx) => {
    return appendHostedMailboxEnvelopeTx({
      envelope,
      tx,
    });
  });
  const mailboxItemId = response.item.id;
  const mailboxItemIdPresent = mailboxItemId.length > 0;

  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: userId,
      mailboxItemId,
    });
  } catch (error) {
    console.warn("Hosted email ingress Temporal signal failed after mailbox append.", {
      errorName: error instanceof Error ? error.name : typeof error,
      mailboxItemIdPresent,
    });
  }

  return jsonOk(response);
});

async function readBoundedHostedEmailIngressRequest(request: Request): Promise<Request> {
  let body: Buffer;

  try {
    body = await readRawBodyBuffer(request, {
      limitBytes: HOSTED_EMAIL_INGRESS_CALLBACK_MAX_BODY_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "HOSTED_EMAIL_INGRESS_CALLBACK_BODY_TOO_LARGE",
        message: "Hosted email ingress callback body is too large.",
        httpStatus: 413,
      });
    }

    throw error;
  }

  return new Request(request.url, {
    body: body.toString("utf8"),
    headers: request.headers,
    method: request.method,
  });
}
