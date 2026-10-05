import "server-only";
import { COMPANION_FOREGROUND_TTL_MS, type CompanionPresence } from "@murphai/hosted-execution/companion-presence";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  WEARABLE_COMMAND_TTL_MS, WEARABLE_SESSION_TTL_MS, WEARABLE_WAKE_COMMAND_TTL_MS,
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
import { forgetCompanionPushRoute, readCompanionPushRoute } from "../companion/push-route";
import { sendApplePush, type ApplePushRequest, type ApplePushResult } from "../apple-push/send";

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

function isWearableSessionReady<T extends { expiresAt: Date }>(session: T | null, presence: CompanionPresence, now: Date): session is T {
  if (!session || !isWearableSessionLive(session, now)) return false;
  // A background report retires an older foreground lease. A newer lease still
  // works for legacy apps and after returning to the foreground.
  const backgroundAt = presence.lastContactAt !== presence.lastForegroundAt
    ? Date.parse(presence.lastContactAt ?? "") : NaN;
  return !(backgroundAt >= session.expiresAt.getTime() - WEARABLE_SESSION_TTL_MS);
}

// Each command names exactly one delivery owner in session_id: a live legacy
// poll session, or the band link a wake-capable app reported. Only that owner
// may claim or settle it, so a command never moves between phones or bands.
// A null id means nothing can claim the command, so it is recorded unavailable.
interface DeliveryOwner { expiresInMs: number; id: string | null }

function readDeliveryOwner(
  session: { expiresAt: Date; sessionId: string } | null,
  link: { linkId: string } | null,
  presence: CompanionPresence,
  now: Date,
): DeliveryOwner {
  if (isWearableSessionReady(session, presence, now)) return { expiresInMs: WEARABLE_COMMAND_TTL_MS, id: session.sessionId };
  if (link) return { expiresInMs: WEARABLE_WAKE_COMMAND_TTL_MS, id: link.linkId };
  return { expiresInMs: WEARABLE_COMMAND_TTL_MS, id: null };
}

// Only a still-queued command bound to the current link needs a wake.
function wakeTargetFor(
  command: { expiresAt: Date; id: string; sessionId: string | null; status: CommandStatus },
  link: { installationId: string; linkId: string } | null,
): WakeTarget | null {
  return command.status === "queued" && link && command.sessionId === link.linkId
    ? { commandId: command.id, expiresAt: command.expiresAt, installationId: link.installationId } : null;
}

async function readUnavailableReason(
  tx: Prisma.TransactionClient,
  memberId: string,
  session: { expiresAt: Date } | null,
  presence: CompanionPresence,
  now: Date,
): Promise<"app_unreachable" | "device_disconnected"> {
  // An unexpired lease that is not ready lost its poller: Murph left the screen.
  if (session && session.expiresAt > now) return "app_unreachable";
  // A wakeable app without a band link means the band is not connected.
  if (await tx.companionPushRoute.findUnique({ where: { userId: memberId }, select: { userId: true } })) {
    return "device_disconnected";
  }
  const foregroundAt = presence.lastForegroundAt ? Date.parse(presence.lastForegroundAt) : NaN;
  return presence.lastContactAt === presence.lastForegroundAt
    && foregroundAt <= now.getTime() && now.getTime() - foregroundAt < COMPANION_FOREGROUND_TTL_MS
    ? "device_disconnected" : "app_unreachable";
}

interface WakeTarget { commandId: string; expiresAt: Date; installationId: string }

type CommandStatus = WearableHapticResponse["status"];

function effectiveCommandStatus(command: { expiresAt: Date; status: string }, now: Date): CommandStatus {
  const status = command.expiresAt <= now && command.status === "queued" ? "expired"
    : command.expiresAt <= now && command.status === "claimed" ? "unknown" : command.status;
  return wearableHapticResponseSchema.shape.status.parse(status);
}

export async function requestWearableHaptic(
  input: { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: WearableHapticRequest },
  dependencies: WearableWakeDependencies = defaultWakeDependencies,
): Promise<WearableHapticResponse> {
  const admitted = await getPrisma().$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requirePersonalMember(tx, input.memberId);
    await requireHapticAuthority(tx, input.memberId, input.request);
    const now = new Date();
    const { wearable, operation } = input.request.request;
    const key = { userId_wearable: { userId: input.memberId, wearable } };
    const session = await tx.companionWearableSession.findUnique({ where: key });
    const link = await tx.companionWearableLink.findUnique({ where: key });
    const presence = await readCompanionPresenceTx(tx, input.memberId, now);
    const owner = readDeliveryOwner(session, link, presence, now);
    const response = (status: CommandStatus, reason?: string | null): WearableHapticResponse => ({
      action: "haptic", wearable, operation, status,
      ...(status === "unavailable" && reason && input.request.includeAvailability
        ? { unavailableReason: wearableUnavailableReasonSchema.parse(reason) } : {}),
    });
    const unavailableReason = () => readUnavailableReason(tx, input.memberId, session, presence, now);
    if (operation === "status") return { response: response(owner.id ? "ready" : "unavailable", owner.id ? null : await unavailableReason()), wake: null };
    const id = wearableCommandId(input.memberId, input.request);
    const previous = await tx.companionWearableCommand.findUnique({ where: { id } });
    if (previous) {
      const status = effectiveCommandStatus(previous, now);
      // A retry of a still-queued wake command re-sends its wake; claimed effects never replay.
      return { response: response(status, previous.unavailableReason), wake: wakeTargetFor({ ...previous, status }, link) };
    }
    // Only one outstanding buzz per owner. A stop cancels unsent buzzes;
    // an already claimed buzz may have reached the band and cannot be undone.
    const pending = owner.id ? await tx.companionWearableCommand.findMany({
      where: { userId: input.memberId, wearable, sessionId: owner.id, status: { in: ["queued", "claimed"] }, expiresAt: { gt: now } },
      select: { id: true, operation: true, status: true }, take: 2,
    }) : [];
    if (operation === "stop") {
      const cancelIds = pending.filter((command) => command.operation === "buzz" && command.status === "queued").map((command) => command.id);
      if (cancelIds.length) await tx.companionWearableCommand.updateMany({ where: { id: { in: cancelIds } }, data: { status: "cancelled" } });
    }
    const occupied = pending.some((command) => operation === "buzz" || command.operation === "stop");
    const status = owner.id && !occupied ? "queued" : "unavailable";
    const reason = status === "unavailable" ? (owner.id ? "busy" : await unavailableReason()) : null;
    const command = { expiresAt: new Date(now.getTime() + owner.expiresInMs), id, sessionId: owner.id, status } as const;
    await tx.companionWearableCommand.create({ data: { ...command, operation, unavailableReason: reason, userId: input.memberId, wearable } });
    return { response: response(status, reason), wake: wakeTargetFor(command, link) };
  }, transactionOptions);
  if (!admitted.wake) return admitted.response;
  return { ...admitted.response, status: await wakeForCommand(input.memberId, admitted.wake, dependencies) };
}

export interface WearableWakeDependencies {
  now: () => number;
  sendPush: (request: ApplePushRequest) => Promise<ApplePushResult>;
  sleep: (ms: number) => Promise<void>;
}

const defaultWakeDependencies: WearableWakeDependencies = {
  now: () => Date.now(),
  sendPush: (request) => sendApplePush(request),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Fixed deadlines from commit keep the whole wake well inside the runtime's
// 30-second callback budget: one poll interval for an open app, a silent push,
// then one visible push. Push outcomes never change the command; an unclaimed
// command expires and reports so.
const WAKE_FOREGROUND_CLAIM_MS = 2_500;
const WAKE_SILENT_CLAIM_MS = 7_000;
const WAKE_OBSERVE_INTERVAL_MS = 500;

async function wakeForCommand(memberId: string, target: WakeTarget, dependencies: WearableWakeDependencies): Promise<CommandStatus> {
  const started = dependencies.now();
  const observe = async (untilMs: number): Promise<CommandStatus> => {
    for (;;) {
      const command = await getPrisma().companionWearableCommand.findUnique({
        where: { id: target.commandId }, select: { expiresAt: true, status: true },
      });
      const status = command ? effectiveCommandStatus(command, new Date(dependencies.now())) : "expired";
      if (status !== "queued" || dependencies.now() >= started + untilMs) return status;
      await dependencies.sleep(WAKE_OBSERVE_INTERVAL_MS);
    }
  };
  const status = await observe(WAKE_FOREGROUND_CLAIM_MS);
  if (status !== "queued") return status;
  const route = await readCompanionPushRoute(memberId, target.installationId);
  if (!route) return status;
  const push = async (message: ApplePushRequest["message"]) => {
    const result = await dependencies.sendPush({
      collapseId: target.commandId, data: { wake: "wearable" }, expiresAt: target.expiresAt, message, target: route.target,
    });
    if (result === "unregistered") await forgetCompanionPushRoute(memberId, route.target.token);
  };
  await push({ kind: "background" });
  const afterSilent = await observe(WAKE_SILENT_CLAIM_MS);
  if (afterSilent !== "queued" || !route.alertsAllowed) return afterSilent;
  await push({ body: "Wrist reminder", kind: "alert", title: "Murph" });
  return observe(0);
}

export async function exchangeWearableCommands(memberId: string, request: WearableCompanionRequest): Promise<WearableCompanionResponse> {
  return getPrisma().$transaction(async (tx) => {
    await requirePersonalMember(tx, memberId);
    const now = new Date();
    const key = { userId: memberId, wearable: request.wearable };
    const where = { userId_wearable: key };
    if ("linkId" in request) {
      const owned = { ...key, installationId: request.installationId, linkId: request.linkId };
      if (request.action === "link") {
        // The latest report wins: a new phone or band replaces the old link,
        // whose bound commands then expire unclaimed.
        const data = { installationId: request.installationId, linkId: request.linkId, updatedAt: now };
        await tx.companionWearableLink.upsert({ where, create: { ...key, ...data }, update: data });
        return { active: true, commands: [] };
      }
      if (request.action === "unlink") {
        await tx.companionWearableLink.deleteMany({ where: owned });
        return { active: false, commands: [] };
      }
      if (request.action === "settle") {
        await settleCommand(tx, key, request.linkId, request);
        return { active: true, commands: [] };
      }
      const current = await tx.companionWearableLink.count({ where: owned });
      return current ? { active: true, commands: await claimCommands(tx, key, request.linkId, now) } : { active: false, commands: [] };
    }
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
      await settleCommand(tx, key, request.sessionId, request);
      return { active: true, commands: [] };
    }
    await tx.companionWearableSession.update({ where, data: { expiresAt: new Date(now.getTime() + WEARABLE_SESSION_TTL_MS) } });
    return { active: true, commands: await claimCommands(tx, key, request.sessionId, now) };
  }, transactionOptions);
}

// The claim commits before the phone sees commands. A lost HTTP response
// drops a buzz rather than redelivering an ambiguous physical effect.
async function claimCommands(
  tx: Prisma.TransactionClient, key: { userId: string; wearable: string }, ownerId: string, now: Date,
): Promise<WearableCompanionResponse["commands"]> {
  const pending = await tx.companionWearableCommand.findMany({
    where: { ...key, sessionId: ownerId, status: "queued", expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" }, take: 2,
    select: { id: true, operation: true, expiresAt: true },
  });
  if (pending.length) await tx.companionWearableCommand.updateMany({
    where: { id: { in: pending.map((command) => command.id) } }, data: { status: "claimed" },
  });
  return pending.map((command) => ({
    id: command.id, operation: wearableOperationSchema.parse(command.operation), expiresAt: command.expiresAt.toISOString(),
  }));
}

async function settleCommand(
  tx: Prisma.TransactionClient, key: { userId: string; wearable: string }, ownerId: string,
  outcome: { commandId: string; status: "acknowledged" | "unknown" },
): Promise<void> {
  await tx.companionWearableCommand.updateMany({
    where: { id: outcome.commandId, ...key, sessionId: ownerId, status: "claimed" },
    data: { status: outcome.status },
  });
}
