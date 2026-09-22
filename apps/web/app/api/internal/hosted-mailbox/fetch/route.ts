import {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
} from "@murphai/hosted-execution/parsers";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readHostedRuntimeIngressCryptoContextForWorker } from "@/src/lib/hosted-crypto/domain-root-store";

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
  getHostedRuntimeUsageMemberSelect,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { requireHostedRuntimeCallbackTx } from "@/src/lib/hosted-execution/runtime-owner";
import { readHostedRuntimeCallbackAuthority } from "@/src/lib/hosted-execution/runtime-write-fence";

const HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  let previousAt = startedAt;
  const timings: Record<string, number> = {};
  const mark = (phase: string) => {
    const now = performance.now();
    timings[phase] = Math.max(0, Math.round(now - previousAt));
    previousAt = now;
  };
  const handle = withJsonError(async (request: Request) => {
    const userId = await requireHostedCloudflareCallbackRequest(request, {
      runtimeAuthority: "caller_transaction",
      maxBodyBytes: HOSTED_MAILBOX_FETCH_CALLBACK_BODY_LIMIT_BYTES,
    });
    mark("auth");
    const prisma = getPrisma();
    const rawBody = await readOptionalJsonObject(request);
    const body = parseHostedMailboxFetchRequest(rawBody);
    const authority = readHostedRuntimeCallbackAuthority(request);
    mark("parse");
    const { mailbox, includeGroupRunningBit } = await prisma.$transaction(async (tx) => {
      mark("transaction_start");
      await requireHostedRuntimeCallbackTx(tx, userId, authority ? { ...authority, userId } : null);
      mark("fence");
      // One fresh projection supplies access, consent and read-first allowance.
      const memberState = await tx.hostedMember.findUnique({
        where: { id: userId },
        select: {
          ...getHostedRuntimeUsageMemberSelect(),
          assistantProviderPreference: true,
          inferenceConnection: { select: { selected: true, revision: true } },
        },
      });
      mark("member");
      const access = await requireHostedRuntimeMailboxActiveAccess(userId, {
        prisma: tx,
        memberState,
      });
      mark("access");
      const assistantCustomInferenceRevision = !access.isThreadContainer
          && memberState?.inferenceConnection?.selected
        ? memberState.inferenceConnection.revision
        : null;
      const fetchedAt = new Date();
      const projection = await fetchHostedRuntimeMailboxProjection({
        prisma: tx,
        cursorMode: body.cursorMode ?? null,
        lanes: body.lanes.map((laneCursor) => ({
          importedSeq: laneCursor.importedSeq,
          lane: laneCursor.lane,
        })),
        limitPerLane: body.limitPerLane,
        now: fetchedAt,
        userId,
      });
      mark("projection");
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
            memberState: memberState ?? undefined,
            prisma: tx,
            userId,
          })
        : { allowed: true, runningLow: false };
      mark("usage");
      if (!usage.allowed) {
        return { includeGroupRunningBit: false, mailbox: parseHostedMailboxFetchResponse({
          assistantProvider: access.assistantProvider,
          assistantCustomInferenceRevision,
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
        }) };
      }
      return { includeGroupRunningBit: conversationWorkPresent && access.isThreadContainer, mailbox: parseHostedMailboxFetchResponse({
        assistantProvider: access.assistantProvider,
        assistantCustomInferenceRevision,
        ...(usage.runningLow ? { conversationUsageStatus: "low" as const } : {}),
        consumedSeqByLane: projection.consumedSeqByLane,
        fetchedAt: fetchedAt.toISOString(),
        items: projection.items,
        maxSeqByLane: projection.maxSeqByLane,
        userId,
      }) };
    });
    mark("transaction_finish");
    // Decrypt optional presentation only after the database transaction ends.
    const groupRunningBit = includeGroupRunningBit
      ? await readHostedActiveGroupRunningBit({ now: new Date(mailbox.fetchedAt), prisma, runtimeMemberId: userId }).catch(() => null)
      : null;
    mark("group");
    const consumed = mailbox.consumedSeqByLane?.find((cursor) => cursor.lane === "conversation");
    const inlineConversationPresent = mailbox.items.some((item) =>
      item.kind === "conversation.message" && item.lane === "conversation"
      && !item.consumedAt && item.payloadInlineCiphertext && !item.payloadRef
      && (!consumed || BigInt(item.laneSeq) > BigInt(consumed.consumedSeq)));
    const ingressCryptoContext = rawBody?.includeIngressCryptoContext === true
      && rawBody.decodeInlinePayloads === true && inlineConversationPresent
      ? await readMailboxIngressCryptoContext({ prisma, userId }).catch(() => null)
      : null;
    mark("crypto");
    // This signed-envelope extension ends at the Worker; the canonical parser strips it.
    const response = jsonOk({ ...mailbox, ...(groupRunningBit ? { groupRunningBit } : {}), ...(ingressCryptoContext ? { ingressCryptoContext } : {}) });
    mark("serialize");
    return response;
  });
  const response = await handle(request);
  timings.total = Math.max(0, Math.round(performance.now() - startedAt));
  // Fixed internal stage names and durations only. Old Workers ignore this
  // optional header; it adds no database operation or telemetry callback.
  response.headers.set("server-timing", Object.entries(timings)
    .map(([phase, duration]) => `murph_mailbox_${phase};dur=${duration}`).join(", "));
  return response;
}

async function readMailboxIngressCryptoContext(input: { prisma: PrismaClient; userId: string }) {
  const workspace = await input.prisma.hostedWorkspace.findUnique({
    select: { userId: true },
    where: { userId: input.userId },
  });
  if (!workspace) return null;
  const context = await readHostedRuntimeIngressCryptoContextForWorker(input);
  return { ...context, fetchedAt: new Date().toISOString() };
}

async function readHostedRuntimeMailboxAiUsageAccess(input: {
  consumedSeqByLane: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["consumedSeqByLane"];
  lanes: Parameters<typeof hostedMailboxItemsRequireAiUsageAccess>[0]["lanes"];
  maxSeqByLane: Parameters<
    typeof readHostedMailboxConversationAiUsageHighWater
  >[0]["lanes"];
  memberState: Parameters<typeof resolveHostedRuntimeAiUsageGate>[0]["memberState"];
  prisma: PrismaClient | Prisma.TransactionClient;
  userId: string;
}): Promise<{ allowed: boolean; runningLow: boolean }> {
  const gate = await resolveHostedRuntimeAiUsageGate({
    mode: "read_first",
    memberState: input.memberState,
    prisma: input.prisma,
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
