import {
  parseHostedMailboxPayloadFetchRequest,
  parseHostedMailboxPayloadFetchResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  fetchHostedMailboxPayload,
  readHostedMailboxItemByDedupeKey,
} from "@/src/lib/hosted-mailbox/store";
import {
  hasHostedMemberActiveAccess,
} from "@/src/lib/hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  hostedRuntimeMailboxEntryNeedsAiUsageGate,
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_MAILBOX_PAYLOAD_FETCH_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_MAILBOX_PAYLOAD_FETCH_CALLBACK_BODY_LIMIT_BYTES,
  });
  await requireHostedRuntimeMailboxPayloadActiveAccess(userId);
  const body = parseHostedMailboxPayloadFetchRequest(await readOptionalJsonObject(request));
  const mailboxItem = await readHostedMailboxItemByDedupeKey({
    dedupeKey: body.dedupeKey,
    userId,
  });
  await requireHostedRuntimeMailboxPayloadAiUsageAccess({
    item: mailboxItem?.id === body.mailboxItemId ? mailboxItem : null,
    userId,
  });
  const response = await fetchHostedMailboxPayload({
    dedupeKey: body.dedupeKey,
    mailboxItemId: body.mailboxItemId,
    ...("payloadRef" in body ? { payloadRef: body.payloadRef } : {}),
    requestId: body.requestId,
    userId,
  });

  return jsonOk(parseHostedMailboxPayloadFetchResponse(response));
});

async function requireHostedRuntimeMailboxPayloadActiveAccess(userId: string): Promise<void> {
  const member = await readHostedMemberCoreState({
    memberId: userId,
    prisma: getPrisma(),
  });

  if (member && hasHostedMemberActiveAccess(member)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_USER_INACTIVE",
    httpStatus: 403,
    message: "Hosted runtime mailbox payload access is not active.",
  });
}

async function requireHostedRuntimeMailboxPayloadAiUsageAccess(input: {
  item: { kind: string; lane: string; userId: string } | null;
  userId: string;
}): Promise<void> {
  if (
    !input.item
    || input.item.userId !== input.userId
    || !hostedRuntimeMailboxEntryNeedsAiUsageGate(input.item)
  ) {
    return;
  }

  const gate = await resolveHostedRuntimeAiUsageGate({
    mode: "read_first",
    userId: input.userId,
  });

  if (gate.status === "allowed") {
    return;
  }

  if (gate.status === "unavailable") {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_AI_USAGE_GATE_UNAVAILABLE",
      details: {
        statusCode: 503,
      },
      httpStatus: 503,
      message: "Hosted runtime mailbox payload AI usage gate is unavailable.",
      retryable: true,
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_PAYLOAD_AI_USAGE_DENIED",
    httpStatus: 403,
    message: "Hosted runtime mailbox payload AI usage is denied.",
  });
}
