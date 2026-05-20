import { Buffer } from "node:buffer";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedMailboxItemOwnerById,
} from "@/src/lib/hosted-mailbox/store";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { readOptionalJsonObject, readRawBodyBuffer } from "@/src/lib/http";

const HOSTED_EMAIL_INGRESS_NUDGE_WORKFLOW_MAX_BODY_BYTES = 2 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const boundedRequest = await readBoundedHostedEmailNudgeWorkflowRequest(request);
  const userId = await requireHostedCloudflareCallbackRequest(boundedRequest);
  const body = parseHostedEmailNudgeWorkflowRequest(
    await readOptionalJsonObject(boundedRequest),
  );
  const mailboxItemOwner = await readHostedMailboxItemOwnerById({
    mailboxItemId: body.mailboxItemId,
  });

  if (!mailboxItemOwner || mailboxItemOwner.userId !== userId) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_INGRESS_NUDGE_WORKFLOW_MAILBOX_ITEM_NOT_FOUND",
      httpStatus: 404,
      message: "Hosted email ingress mailbox item was not found.",
    });
  }

  const signal = await signalHostedMailboxAppendRuntime({
    expectedUserId: userId,
    mailboxItemId: body.mailboxItemId,
    source: "email",
  });

  return jsonOk(signal);
});

async function readBoundedHostedEmailNudgeWorkflowRequest(request: Request): Promise<Request> {
  let body: Buffer;

  try {
    body = await readRawBodyBuffer(request, {
      limitBytes: HOSTED_EMAIL_INGRESS_NUDGE_WORKFLOW_MAX_BODY_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "HOSTED_EMAIL_INGRESS_NUDGE_WORKFLOW_BODY_TOO_LARGE",
        httpStatus: 413,
        message: "Hosted email ingress nudge workflow body is too large.",
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

function parseHostedEmailNudgeWorkflowRequest(value: unknown): {
  mailboxItemId: string;
} {
  if (!isRecord(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_INGRESS_NUDGE_WORKFLOW_BODY_INVALID",
      httpStatus: 400,
      message: "Hosted email ingress nudge workflow body is invalid.",
    });
  }

  const mailboxItemId = requireNonEmptyString(value.mailboxItemId);

  return {
    mailboxItemId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_INGRESS_NUDGE_WORKFLOW_MAILBOX_ITEM_INVALID",
      httpStatus: 400,
      message: "Hosted email ingress nudge workflow mailbox item id is invalid.",
    });
  }

  return value;
}
