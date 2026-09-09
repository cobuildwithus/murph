import {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
} from "@murphai/hosted-execution/parsers";
import type { PrismaClient } from "@prisma/client";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  readHostedActiveGroupRunningBit,
} from "@/src/lib/hosted-groups/group-sponsorship-store";
import {
  requireHostedRuntimeMailboxActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  hostedMailboxItemsRequireAiUsageAccess,
  readHostedMailboxConversationAiUsageHighWater,
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

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES,
  });
  const access = await requireHostedRuntimeMailboxActiveAccess(userId);
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
  const conversationWorkPresent = hostedMailboxItemsRequireAiUsageAccess({
    consumedSeqByLane: projection.consumedSeqByLane,
    items: projection.items.map((item) => ({
      consumedAt: item.consumedAt ?? null,
      lane: item.lane,
      laneSeq: item.laneSeq,
      payloadInlineCiphertext: item.payloadInlineCiphertext ?? null,
      payloadRef: item.payloadRef ?? null,
    })),
    lanes: body.lanes,
  });
  const usage = conversationWorkPresent
    ? await readHostedRuntimeMailboxAiUsageAccess({
        consumedSeqByLane: projection.consumedSeqByLane,
        lanes: body.lanes,
        maxSeqByLane: projection.maxSeqByLane,
        prisma,
        userId,
      })
    : { allowed: true, runningLow: false };
  if (!usage.allowed) {
    return jsonOk(parseHostedMailboxFetchResponse({
      assistantProvider: access.assistantProvider,
      consumedSeqByLane: body.lanes.map(({ importedSeq, lane }) => ({
        consumedSeq: importedSeq,
        lane,
      })),
      fetchedAt: fetchedAt.toISOString(),
      items: [],
      maxSeqByLane: body.lanes.map(({ importedSeq, lane }) => ({
        lane,
        maxSeq: importedSeq,
      })),
      userId,
    }));
  }
  // Sponsorship color is presentation for conversation imports only. An
  // empty, consumed-replay, or system-only batch cannot consume it.
  const groupRunningBit = conversationWorkPresent && access.isThreadContainer
    ? await readHostedActiveGroupRunningBit({
        now: fetchedAt,
        prisma,
        runtimeMemberId: userId,
      }).catch(() => null)
    : null;

  return jsonOk(parseHostedMailboxFetchResponse({
    assistantProvider: access.assistantProvider,
    ...(usage.runningLow ? { conversationUsageStatus: "low" as const } : {}),
    ...(groupRunningBit ? { groupRunningBit } : {}),
    consumedSeqByLane: projection.consumedSeqByLane,
    fetchedAt: fetchedAt.toISOString(),
    items: projection.items,
    maxSeqByLane: projection.maxSeqByLane,
    userId,
  }));
});

async function readHostedRuntimeMailboxAiUsageAccess(input: {
  consumedSeqByLane: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["consumedSeqByLane"];
  lanes: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["lanes"];
  maxSeqByLane: Parameters<
    typeof readHostedMailboxConversationAiUsageHighWater
  >[0]["lanes"];
  prisma: PrismaClient;
  userId: string;
}): Promise<{ allowed: boolean; runningLow: boolean }> {
  const gate = await resolveHostedRuntimeAiUsageGate({
    mode: "read_first",
    userId: input.userId,
  });

  if (gate.status === "allowed") {
    return { allowed: true, runningLow: gate.usageRunningLow === true };
  }

  await tryMarkHostedMailboxConversationAiUsageDenied({
    afterConversationLaneSeq:
      readHostedMailboxConversationAiUsageReplayFloor(input),
    prisma: input.prisma,
    throughConversationLaneSeq:
      readHostedMailboxConversationAiUsageHighWater({
        lanes: input.maxSeqByLane,
      }),
    userId: input.userId,
  });

  return { allowed: false, runningLow: false };
}
