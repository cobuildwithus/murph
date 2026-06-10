import {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  requireHostedRuntimeMailboxActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  fetchHostedMailboxItemsAfterLaneCursors,
  readHostedMailboxConsumedSeqByLane,
  readHostedMailboxMaxSeqByLane,
} from "@/src/lib/hosted-mailbox/store";
import {
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES,
  });
  await requireHostedRuntimeMailboxActiveAccess(userId);
  const body = parseHostedMailboxFetchRequest(await readOptionalJsonObject(request));
  const [itemsResult, maxSeqByLane, consumedSeqByLane] = await Promise.all([
    fetchHostedMailboxItemsAfterLaneCursors({
      lanes: body.lanes.map((laneCursor) => ({
        afterSeq: laneCursor.importedSeq,
        lane: laneCursor.lane,
      })),
      limitPerLane: body.limitPerLane,
      userId,
    }),
    readHostedMailboxMaxSeqByLane({
      lanes: body.lanes.map((laneCursor) => laneCursor.lane),
      userId,
    }),
    readHostedMailboxConsumedSeqByLane({
      lanes: body.lanes.map((laneCursor) => laneCursor.lane),
      userId,
    }),
  ]);
  await requireHostedRuntimeMailboxAiUsageAccess({
    items: itemsResult.items,
    userId,
  });

  return jsonOk(parseHostedMailboxFetchResponse({
    consumedSeqByLane,
    fetchedAt: new Date().toISOString(),
    items: itemsResult.items,
    maxSeqByLane,
    userId,
  }));
});

async function requireHostedRuntimeMailboxAiUsageAccess(input: {
  items: readonly { kind: string; lane: string }[];
  userId: string;
}): Promise<void> {
  if (!hostedRuntimeMailboxItemsNeedAiUsageGate(input.items)) {
    return;
  }

  const gate = await resolveHostedRuntimeAiUsageGate({
    userId: input.userId,
  });

  if (gate.status === "allowed") {
    return;
  }

  if (gate.status === "unavailable") {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_MAILBOX_AI_USAGE_GATE_UNAVAILABLE",
      details: {
        statusCode: 503,
      },
      httpStatus: 503,
      message: "Hosted runtime mailbox AI usage gate is unavailable.",
      retryable: true,
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED",
    httpStatus: 403,
    message: "Hosted runtime mailbox AI usage is denied.",
  });
}

function hostedRuntimeMailboxItemsNeedAiUsageGate(
  items: readonly { kind: string; lane: string }[],
): boolean {
  // Gate the whole fetch batch: runtime imports lanes together, and all-or-nothing
  // watermarks are simpler than returning partial lane output around denied AI work.
  return items.some((item) =>
    item.lane === "conversation"
    || item.kind === "runtime.manual-requested"
  );
}
