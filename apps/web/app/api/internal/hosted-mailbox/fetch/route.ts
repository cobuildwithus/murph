import {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
} from "@murphai/hosted-execution/parsers";
import type { PrismaClient } from "@prisma/client";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedActiveGroupRunningBit,
} from "@/src/lib/hosted-groups/group-sponsorship-store";
import {
  requireHostedRuntimeMailboxActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  hostedMailboxItemsRequireAiUsageAccess,
  readHostedMailboxConversationAiUsageReplayFloor,
} from "@/src/lib/hosted-mailbox/ai-usage-gate";
import {
  fetchHostedRuntimeMailboxProjection,
  tryMarkHostedMailboxConversationAiUsageDenied,
} from "@/src/lib/hosted-mailbox/store";
import {
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

type HostedRuntimeMailboxAiUsageItem = {
  consumedAt?: string | null;
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
  const prisma = getPrisma();
  const fetchedAt = new Date();
  const projection = await fetchHostedRuntimeMailboxProjection({
    cursorMode: body.cursorMode ?? null,
    lanes: body.lanes.map((laneCursor) => ({
      importedSeq: laneCursor.importedSeq,
      lane: laneCursor.lane,
    })),
    limitPerLane: body.limitPerLane,
    now: fetchedAt,
    userId,
  });
  const usageRunningLow = await requireHostedRuntimeMailboxAiUsageAccess({
    at: fetchedAt,
    consumedSeqByLane: projection.consumedSeqByLane,
    items: projection.items,
    lanes: body.lanes,
    prisma,
    userId,
  });
  // Sponsorship color is optional; it must never block ordinary mailbox work.
  const groupRunningBit = await readHostedActiveGroupRunningBit({
    now: fetchedAt,
    prisma,
    runtimeMemberId: userId,
  }).catch(() => null);

  return jsonOk(parseHostedMailboxFetchResponse({
    ...(usageRunningLow ? { conversationUsageStatus: "low" as const } : {}),
    ...(groupRunningBit ? { groupRunningBit } : {}),
    consumedSeqByLane: projection.consumedSeqByLane,
    fetchedAt: fetchedAt.toISOString(),
    items: projection.items,
    maxSeqByLane: projection.maxSeqByLane,
    userId,
  }));
});

async function requireHostedRuntimeMailboxAiUsageAccess(input: {
  at: Date;
  consumedSeqByLane: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["consumedSeqByLane"];
  items: readonly HostedRuntimeMailboxAiUsageItem[];
  lanes: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["lanes"];
  prisma: PrismaClient;
  userId: string;
}): Promise<boolean> {
  // Gate the whole fetch batch: runtime imports lanes together, and all-or-nothing
  // watermarks are simpler than returning partial lane output around denied AI work.
  if (!hostedMailboxItemsRequireAiUsageAccess({
    consumedSeqByLane: input.consumedSeqByLane,
    items: input.items.map((item) => ({
      consumedAt: item.consumedAt ?? null,
      lane: item.lane,
      laneSeq: item.laneSeq,
      payloadInlineCiphertext: item.payloadInlineCiphertext ?? null,
      payloadRef: item.payloadRef ?? null,
    })),
    lanes: input.lanes,
  })) {
    return false;
  }

  const gate = await resolveHostedRuntimeAiUsageGate({
    mode: "read_first",
    userId: input.userId,
  });

  if (gate.status === "allowed") {
    return gate.usageRunningLow === true;
  }

  await tryMarkHostedMailboxConversationAiUsageDenied({
    afterConversationLaneSeq:
      readHostedMailboxConversationAiUsageReplayFloor(input),
    at: input.at,
    prisma: input.prisma,
    userId: input.userId,
  });

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED",
    httpStatus: 403,
    message: "Hosted runtime mailbox AI usage is denied.",
  });
}
