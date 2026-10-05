import "server-only";
import { COMPANION_FOREGROUND_TTL_MS, type CompanionPresence } from "@murphai/hosted-execution/companion-presence";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  WEARABLE_COMMAND_TTL_MS, WEARABLE_SESSION_TTL_MS,
  wearableHapticResponseSchema, wearableOperationSchema, wearableUnavailableReasonSchema,
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
import { readHostedMailboxConversationInputAuthorityByAssistantInputIdTx, readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requirePersonalMember } from "../companion/member-access";
import { readCompanionPresenceTx } from "../companion/presence";

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

// The phone renews its lease on every two-second poll while Murph is open. An
// unexpired lease alone does not prove a poller remains, so admission and
// displacement protection need a renewal within four poll intervals.
const WEARABLE_SESSION_LIVE_MS = 8_000;

function isWearableSessionLive(session: { expiresAt: Date }, now: Date): boolean {
  const renewedAt = session.expiresAt.getTime() - WEARABLE_SESSION_TTL_MS;
  return session.expiresAt > now && now.getTime() - renewedAt < WEARABLE_SESSION_LIVE_MS;
}

function isWearableSessionReady(session: { expiresAt: Date } | null, presence: CompanionPresence, now: Date): session is { expiresAt: Date } {
  if (!session || !isWearableSessionLive(session, now)) return false;
  // A background report retires an older foreground lease. A newer lease still
  // works for legacy apps and after returning to the foreground.
  const backgroundAt = presence.lastContactAt !== presence.lastForegroundAt
    ? Date.parse(presence.lastContactAt ?? "") : NaN;
  return !(backgroundAt >= session.expiresAt.getTime() - WEARABLE_SESSION_TTL_MS);
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
    const presence = await readCompanionPresenceTx(tx, input.memberId, now);
    const ready = isWearableSessionReady(session, presence, now);
    const response = (status: WearableHapticResponse["status"], reason?: string | null): WearableHapticResponse => ({
      action: "haptic", wearable, operation, status,
      ...(status === "unavailable" && reason && input.request.includeAvailability
        ? { unavailableReason: wearableUnavailableReasonSchema.parse(reason) } : {}),
    });
    const unavailableReason = () => {
      // An unexpired lease that is not ready lost its poller: Murph left the screen.
      if (session && session.expiresAt > now) return "app_unreachable" as const;
      const foregroundAt = presence.lastForegroundAt ? Date.parse(presence.lastForegroundAt) : NaN;
      return presence.lastContactAt === presence.lastForegroundAt
        && foregroundAt <= now.getTime() && now.getTime() - foregroundAt < COMPANION_FOREGROUND_TTL_MS
        ? "device_disconnected" as const : "app_unreachable" as const;
    };
    if (operation === "status") return response(ready ? "ready" : "unavailable", ready ? null : unavailableReason());
    const id = wearableCommandId(input.memberId, input.request);
    const previous = await tx.companionWearableCommand.findUnique({ where: { id } });
    if (previous) {
      const status = previous.expiresAt <= now && previous.status === "queued" ? "expired"
        : previous.expiresAt <= now && previous.status === "claimed" ? "unknown" : previous.status;
      return wearableHapticResponseSchema.parse(response(wearableHapticResponseSchema.shape.status.parse(status), previous.unavailableReason));
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
    const reason = status === "unavailable" ? (ready ? "busy" : unavailableReason()) : null;
    await tx.companionWearableCommand.create({ data: {
      id, userId: input.memberId, wearable, operation, status, unavailableReason: reason,
      sessionId: ready ? session.sessionId : null,
      expiresAt: new Date(now.getTime() + WEARABLE_COMMAND_TTL_MS),
    } });
    return response(status, reason);
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
      if (current && isWearableSessionLive(current, now) && current.sessionId !== request.sessionId) return { active: false, commands: [] };
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
