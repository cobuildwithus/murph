import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  WEARABLE_COMMAND_TTL_MS, WEARABLE_SESSION_TTL_MS,
  wearableHapticResponseSchema, wearableOperationSchema,
  type WearableCompanionRequest, type WearableCompanionResponse,
  type WearableHapticRequest, type WearableHapticResponse,
} from "@murphai/hosted-execution/wearable-haptics";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import { getPrisma } from "../prisma";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { readHostedMailboxConversationInputAuthorityByAssistantInputIdTx, readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";

const transactionOptions = { maxWait: 5_000, timeout: 5_000 };

// A stable key survives runtime retries. Model arguments never choose it.
export function wearableCommandId(memberId: string, input: WearableHapticRequest): string {
  return createHash("sha256").update(JSON.stringify([
    "murph.wearable-command.v1", memberId, input.authority.kind,
    input.authority.kind === "accepted_input"
      ? input.authority.assistantInputId
      : [input.authority.automationId, input.authority.occurrenceAt],
    input.request.wearable, input.request.operation,
  ])).digest("hex");
}

async function requirePersonalMember(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
  await requireHostedRuntimeActiveAccessForUpdateTx(memberId, { prisma: tx });
  const group = await tx.hostedThreadContainer.findUnique({ where: { memberId }, select: { memberId: true } });
  if (group) throw new TypeError("Wrist reminders require a private member conversation.");
  await assertHostedHistoricalLaunchConsentGranted({ memberId, prisma: tx });
}

async function requireHapticAuthority(tx: Prisma.TransactionClient, memberId: string, input: WearableHapticRequest): Promise<void> {
  if (input.authority.kind === "automation_occurrence") return;
  const assistantInputId = input.authority.assistantInputId;
  const authority = await readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({ assistantInputId, memberId, prisma: tx });
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({ assistantInputId, memberId, prisma: tx });
  const direct = wake && (
    (isHostedLinqConversationMessageWake(wake) && wake.message.linqMessage.threadIsDirect === true)
    || (isHostedTelegramConversationMessageWake(wake) && wake.message.telegramMessage.threadIsDirect === true)
    || (isHostedEmailConversationMessageWake(wake) && wake.message.threadIsDirect === true && wake.message.assistantStyleSettingsAuthorized === true)
  );
  if (!authority || !direct) throw new TypeError("Wrist reminders require current private member input.");
}

export async function requestWearableHaptic(input: {
  memberId: string;
  runtimeIdentity: HostedRuntimeIdentity | null;
  request: WearableHapticRequest;
}): Promise<WearableHapticResponse> {
  return getPrisma().$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requirePersonalMember(tx, input.memberId);
    await requireHapticAuthority(tx, input.memberId, input.request);
    const now = new Date();
    const { wearable, operation } = input.request.request;
    const session = await tx.companionWearableSession.findUnique({
      where: { userId_wearable: { userId: input.memberId, wearable } },
    });
    const ready = session !== null && session.expiresAt > now;
    const response = (status: WearableHapticResponse["status"]): WearableHapticResponse => ({ action: "haptic", wearable, operation, status });
    if (operation === "status") return response(ready ? "ready" : "unavailable");
    const id = wearableCommandId(input.memberId, input.request);
    const previous = await tx.companionWearableCommand.findUnique({ where: { id } });
    if (previous) {
      const status = previous.expiresAt <= now && previous.status === "queued" ? "expired"
        : previous.expiresAt <= now && previous.status === "claimed" ? "unknown" : previous.status;
      return wearableHapticResponseSchema.parse({ action: "haptic", wearable, operation, status });
    }
    // Only one outstanding buzz per session. A stop cancels unsent buzzes;
    // an already claimed buzz may have reached the band and cannot be undone.
    const pending = ready ? await tx.companionWearableCommand.findMany({
      where: { userId: input.memberId, wearable, sessionId: session.sessionId, status: { in: ["queued", "claimed"] }, expiresAt: { gt: now } },
      select: { id: true, operation: true, status: true }, take: 2,
    }) : [];
    if (operation === "stop") {
      const cancelIds = pending.filter((command) => command.operation === "buzz" && command.status === "queued").map((command) => command.id);
      if (cancelIds.length) await tx.companionWearableCommand.updateMany({ where: { id: { in: cancelIds } }, data: { status: "cancelled" } });
    }
    const occupied = pending.some((command) => operation === "buzz" || command.operation === "stop");
    const status = ready && !occupied ? "queued" : "unavailable";
    await tx.companionWearableCommand.create({ data: {
      id, userId: input.memberId, wearable, operation, status,
      sessionId: ready ? session.sessionId : null,
      expiresAt: new Date(now.getTime() + WEARABLE_COMMAND_TTL_MS),
    } });
    return response(status);
  }, transactionOptions);
}

export async function exchangeWearableCommands(memberId: string, request: WearableCompanionRequest): Promise<WearableCompanionResponse> {
  return getPrisma().$transaction(async (tx) => {
    await requirePersonalMember(tx, memberId);
    const now = new Date();
    const key = { userId: memberId, wearable: request.wearable };
    const where = { userId_wearable: key };
    const current = await tx.companionWearableSession.findUnique({ where });
    if (request.action === "connect") {
      // A second phone cannot displace an active connection. Retired pollers
      // cannot register again without a fresh, explicit native connection.
      if (current && current.expiresAt > now && current.sessionId !== request.sessionId) return { active: false, commands: [] };
      const data = { sessionId: request.sessionId, expiresAt: new Date(now.getTime() + WEARABLE_SESSION_TTL_MS) };
      await tx.companionWearableSession.upsert({ where, create: { ...key, ...data }, update: data });
      return { active: true, commands: [] };
    }
    if (!current || current.sessionId !== request.sessionId || current.expiresAt <= now) return { active: false, commands: [] };
    if (request.action === "disconnect") {
      await tx.companionWearableSession.delete({ where });
      return { active: false, commands: [] };
    }
    if (request.action === "receipt") {
      await tx.companionWearableCommand.updateMany({
        where: { id: request.commandId, ...key, sessionId: request.sessionId, status: "claimed" },
        data: { status: request.status },
      });
      return { active: true, commands: [] };
    }
    await tx.companionWearableSession.update({ where, data: { expiresAt: new Date(now.getTime() + WEARABLE_SESSION_TTL_MS) } });
    const pending = await tx.companionWearableCommand.findMany({
      where: { ...key, sessionId: request.sessionId, status: "queued", expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" }, take: 2,
      select: { id: true, operation: true, expiresAt: true },
    });
    if (pending.length) await tx.companionWearableCommand.updateMany({
      where: { id: { in: pending.map((command) => command.id) } }, data: { status: "claimed" },
    });
    // The claim commits before the phone sees commands. A lost HTTP response
    // drops a buzz rather than redelivering an ambiguous physical effect.
    return { active: true, commands: pending.map((command) => ({
      id: command.id, operation: wearableOperationSchema.parse(command.operation), expiresAt: command.expiresAt.toISOString(),
    })) };
  }, transactionOptions);
}
