import "server-only";
import type { HostedConversationPoll } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { buildConversationPollResultInstructions } from "@murphai/hosted-execution/conversation-polls";
import { getPrisma } from "../prisma";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxItemByDedupeKey } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccess, isHostedRuntimeInactiveAccessError, hasHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { resolveHostedAssistantNotificationDestination, bindHostedAssistantNotificationDestination, assertHostedAssistantNotificationRouteAuthority } from "../hosted-routing/assistant-notification-destination";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { readPollDefinition, readPollResult } from "./store";
import { readPollCompletion } from "./completion";

function notificationKey(row: HostedConversationPoll) { return `poll-result:${row.id}`; }

export async function recoverPollResultWake(row: HostedConversationPoll): Promise<void> {
  const item = await readHostedMailboxItemByDedupeKey({ dedupeKey: notificationKey(row), userId: row.memberId, prisma: getPrisma() });
  if (item && item.consumedAt === null) await signalHostedMailboxAppendRuntime({ expectedUserId: row.memberId, mailboxItemId: item.id });
}

export async function maybeNotifyPollResult(row: HostedConversationPoll, voterHandlesByOption?: readonly (readonly string[])[]): Promise<void> {
  if (row.resultNotifiedAt) return recoverPollResultWake(row);
  const prisma = getPrisma();
  try { await requireHostedRuntimeActiveAccess(row.memberId, { prisma }); }
  catch (error) { if (isHostedRuntimeInactiveAccessError(error)) return; throw error; }
  const definition = await readPollDefinition(row);
  const result = await readPollResult(row);
  if (!result) return;
  const destination = await resolveHostedAssistantNotificationDestination({ memberId: row.memberId, directChannel: row.channel === "linq" ? "linq" : "telegram", prisma });
  if (!destination || destination.route.channel !== row.channel || destination.route.delivery.kind !== "thread" || destination.route.delivery.target !== definition.target) return;
  const completion = await readPollCompletion({ target: definition.target, snapshot: result.snapshot, voterHandlesByOption });
  if (!completion) return;
  const bound = bindHostedAssistantNotificationDestination({ destination, memberId: row.memberId });
  const key = notificationKey(row);
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    memberId: row.memberId, eventId: key, occurredAt: result.snapshot.observedAt,
    notification: { ...bound, instructions: buildConversationPollResultInstructions(result.snapshot, completion), responsePolicy: { kind: "allow_send_or_skip" }, deliveryDedupeToken: key, deliveryIdempotencyKey: key, deliveryDispatchMode: "queue-only" },
  }) });
  const appended = await prisma.$transaction(async (tx) => {
    if (!await hasHostedRuntimeActiveAccessForUpdateTx(row.memberId, { prisma: tx })) return null;
    if (bound.externalThreadRouteAuthority) await assertHostedAssistantNotificationRouteAuthority({ authority: bound.externalThreadRouteAuthority, prisma: tx });
    const claimed = await tx.hostedConversationPoll.updateMany({ where: { id: row.id, resultNotifiedAt: null, resultEncrypted: row.resultEncrypted }, data: { resultNotifiedAt: new Date() } });
    if (claimed.count !== 1) return null;
    return appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
  });
  if (appended) await signalHostedMailboxAppendRuntime({ expectedUserId: row.memberId, mailboxItemId: appended.mailboxItemId });
}
