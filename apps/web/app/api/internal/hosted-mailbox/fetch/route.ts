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
  hostedMailboxItemsRequireAiUsageAccess,
} from "@/src/lib/hosted-mailbox/ai-usage-gate";
import {
  fetchHostedMailboxItemsAfterLaneCursors,
  readHostedMailboxConsumedSeqByLane,
  readHostedMailboxMaxSeqByLane,
  resolveHostedMailboxRuntimeFetchLaneCursors,
} from "@/src/lib/hosted-mailbox/store";
import {
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

type HostedRuntimeMailboxAiUsageItem = {
  kind: string;
  lane: string;
  laneSeq: string;
  payloadInlineCiphertext?: string | null;
  payloadRef?: string | null;
};

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES,
  });
  await requireHostedRuntimeMailboxActiveAccess(userId);
  const body = parseHostedMailboxFetchRequest(await readOptionalJsonObject(request));
  const requestedLanes = body.lanes.map((laneCursor) => laneCursor.lane);
  const fetchedAt = new Date();
  const consumedSeqByLane = await readHostedMailboxConsumedSeqByLane({
    lanes: requestedLanes,
    userId,
  });
  const laneCursors = resolveHostedMailboxRuntimeFetchLaneCursors({
    consumedSeqByLane,
    cursorMode: body.cursorMode ?? null,
    lanes: body.lanes.map((laneCursor) => ({
      importedSeq: laneCursor.importedSeq,
      lane: laneCursor.lane,
    })),
  });
  const itemsResult = await fetchHostedMailboxItemsAfterLaneCursors({
    lanes: laneCursors,
    limitPerLane: body.limitPerLane,
    now: fetchedAt,
    userId,
  });
  await requireHostedRuntimeMailboxAiUsageAccess({
    consumedSeqByLane,
    items: itemsResult.items,
    lanes: body.lanes,
    userId,
  });
  const maxSeqByLane = await readHostedMailboxMaxSeqByLane({
    lanes: requestedLanes,
    userId,
  });

  return jsonOk(parseHostedMailboxFetchResponse({
    consumedSeqByLane,
    fetchedAt: fetchedAt.toISOString(),
    items: itemsResult.items,
    maxSeqByLane,
    userId,
  }));
});

async function requireHostedRuntimeMailboxAiUsageAccess(input: {
  consumedSeqByLane: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["consumedSeqByLane"];
  items: readonly HostedRuntimeMailboxAiUsageItem[];
  lanes: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["lanes"];
  userId: string;
}): Promise<void> {
  // Gate the whole fetch batch: runtime imports lanes together, and all-or-nothing
  // watermarks are simpler than returning partial lane output around denied AI work.
  if (!hostedMailboxItemsRequireAiUsageAccess({
    consumedSeqByLane: input.consumedSeqByLane,
    items: input.items.map((item) => ({
      kind: item.kind,
      lane: item.lane,
      laneSeq: item.laneSeq,
      payloadInlineCiphertext: item.payloadInlineCiphertext ?? null,
      payloadRef: item.payloadRef ?? null,
    })),
    lanes: input.lanes,
  })) {
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
