import "server-only";

import { Prisma } from "@prisma/client";
import { formatTimeZoneDateTimeParts, resolveFloatingIsoTimestampInTimeZone } from "@murphai/contracts";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { buildGamePrivateKickoffInstructions, gamePrivateKickoffPolicySchema, type HostedGamePrivateKickoffPolicy } from "@murphai/hosted-execution/runtime-control";
import { buildHostedLinqDeliveryId } from "../hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
import { assertHostedDirectAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import { isGameOn } from "./access";
import { readMyGameReminderProjection } from "./direct-tool";
import { currentTerms, parseStoredTerms } from "./rules";
import { canTextGameReminders } from "./service";

const enabled = () => process.env.MURPH_GAME_PRIVATE_REMINDERS_ENABLED === "true";
export const privateKickoffEventId = (gameId: string, memberId: string) => `game-dm:${gameId}:${memberId}`;
const activationKey = (gameId: string, memberId: string) => `game-reminder-activation:${gameId}:${memberId}`;

function rhythm(game: { terms: Prisma.JsonValue; lengthDays: number }) {
  const schedule = currentTerms(parseStoredTerms(game.terms)).schedule;
  return JSON.stringify({ lengthDays: game.lengthDays, schedule: "days" in schedule
    ? { days: [...new Set(schedule.days)].sort((a, b) => a - b) } : schedule });
}

function morningAfter(now: Date, zone: string): Date | null {
  try {
    const local = formatTimeZoneDateTimeParts(now, zone);
    const minutes = local.hour * 60 + local.minute;
    if (minutes >= 9 * 60 && minutes < 21 * 60) return now;
    const day = minutes >= 21 * 60 ? new Date(`${local.dayKey}T00:00:00Z`) : null;
    if (day) day.setUTCDate(day.getUTCDate() + 1);
    const date = day?.toISOString().slice(0, 10) ?? local.dayKey;
    const resolved = resolveFloatingIsoTimestampInTimeZone(`${date}T09:00:00`, zone);
    return resolved ? new Date(resolved.timestamp) : null;
  } catch { return null; }
}

/** The existing game event is the one-time activation marker, including silent rematches. */
export async function activatePrivateGamePlayers(gameId: string, now = new Date()): Promise<void> {
  if (!enabled()) return;
  const db = getPrisma();
  const game = await db.game.findUnique({ where: { id: gameId }, select: { id: true, status: true, startedAt: true,
    players: { where: { leftAt: null, memberId: { not: null } }, select: { memberId: true } } } });
  if (game?.status !== "live" || !game.startedAt) return;
  for (const player of game.players) if (player.memberId) await activateOne(gameId, player.memberId, now);
}

async function activateOne(gameId: string, memberId: string, now: Date): Promise<void> {
  const db = getPrisma();
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
    const game = await tx.game.findUnique({ where: { id: gameId }, include: { players: true } });
    if (!game || game.status !== "live" || !game.startedAt || !game.players.some(seat => seat.memberId === memberId && !seat.leftAt)) return;
    if (await tx.gameEvent.findUnique({ where: { commandKey: activationKey(gameId, memberId) }, select: { id: true } })) return;
    const people = game.players.flatMap(seat => seat.memberId && !seat.leftAt ? [seat.memberId] : []).sort();
    const previous = await findPreviousGameTx(tx, gameId, game.previousGameId, memberId, people, game.startedAt);
    const oldSeat = previous?.players.find(seat => seat.memberId === memberId);
    if (oldSeat) await tx.gamePlayer.updateMany({ where: { gameId, memberId },
      data: { reminderOff: oldSeat.reminderOff, reminderEveryDay: oldSeat.reminderEveryDay } });
    const newPerson = await hasNewPeerTx(tx, gameId, memberId, people, game.startedAt);
    const messageKind = newPerson ? "new_person" : previous && rhythm(game) !== rhythm(previous) ? "new_rhythm" : null;
    await tx.gameEvent.create({ data: { gameId, actor: "system", type: "reminder_activation", commandKey: activationKey(gameId, memberId),
      payload: { messageKind: messageKind ?? "none" } } });
    if (!messageKind || now.getTime() >= game.startedAt.getTime() + 24 * 60 * 60_000) return;
    const profile = await tx.gameProfile.findUnique({ where: { memberId }, select: { timeZone: true } });
    if (!profile) return;
    const key = createHostedLinqDeliveryIdempotencyLookupKey(privateKickoffEventId(gameId, memberId))!;
    const due = morningAfter(now, profile.timeZone);
    if (!due) return;
    await tx.hostedLinqDelivery.createMany({ data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
      source: "game_lifecycle", sourceRef: `${gameId}:${memberId}`, template: "game_private_kickoff", status: "awaiting_generation",
      targetKind: "thread", payloadOwnerMemberId: memberId, attemptedAt: now, retryAfterAt: due, createdAt: now }], skipDuplicates: true });
  });
}

async function findPreviousGameTx(tx: Prisma.TransactionClient, gameId: string, previousGameId: string | null, memberId: string, people: string[], startedAt: Date) {
  const lineage = previousGameId ? await tx.game.findUnique({ where: { id: previousGameId }, include: { players: true } }) : null;
  if (lineage?.players.some(seat => seat.memberId === memberId)) return lineage;
  if (people.length < 2) return null;
  const candidates = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT g.id FROM game g JOIN game_player p ON p.game_id = g.id
    WHERE g.id <> ${gameId} AND g.status IN ('live', 'settled') AND g.started_at < ${startedAt}
      AND p.member_id IS NOT NULL AND p.left_at IS NULL
    GROUP BY g.id HAVING array_agg(p.member_id ORDER BY p.member_id) = ARRAY[${Prisma.join(people)}]::text[]
    ORDER BY max(g.started_at) DESC, g.id DESC LIMIT 1`;
  return candidates[0] ? tx.game.findUnique({ where: { id: candidates[0].id }, include: { players: true } }) : null;
}

async function hasNewPeerTx(tx: Prisma.TransactionClient, gameId: string, memberId: string, people: string[], startedAt: Date): Promise<boolean> {
  for (const peer of people.filter(id => id !== memberId)) {
    const played = await tx.game.findFirst({ where: { id: { not: gameId }, status: { in: ["live", "settled"] },
      startedAt: { lt: startedAt }, players: { some: { memberId } }, AND: [{ players: { some: { memberId: peer } } }] }, select: { id: true } });
    if (!played) return true;
  }
  return false;
}

/** Recover activations after a post-commit failure; the event marker makes replay inert. */
export async function reconcilePrivateGameActivations(now = new Date(), options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<number> {
  if (!enabled()) return 0;
  const db = getPrisma();
  const candidates = await db.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT g.id FROM game g JOIN game_player p ON p.game_id = g.id
    WHERE g.status = 'live' AND g.started_at > ${new Date(now.getTime() - 24 * 60 * 60_000)}
      AND p.member_id IS NOT NULL AND p.left_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM game_event e WHERE e.command_key = 'game-reminder-activation:' || g.id || ':' || p.member_id)
    ORDER BY g.id LIMIT 20`;
  let attempted = 0;
  for (const candidate of candidates) {
    if (options.signal?.aborted || Date.now() >= (options.deadlineMs ?? Infinity)) break;
    await activatePrivateGamePlayers(candidate.id, now);
    attempted += 1;
  }
  return attempted;
}

export async function isPrivateKickoffCurrentTx(policy: HostedGamePrivateKickoffPolicy, tx: Prisma.TransactionClient, now: Date): Promise<boolean> {
  if (!enabled() || now >= new Date(policy.expiresAt) || !await canTextGameReminders(policy.memberId, tx)) return false;
  const game = await tx.game.findUnique({ where: { id: policy.gameId }, select: { status: true, invitees: { select: { memberId: true } },
    players: { select: { memberId: true, leftAt: true } } } });
  return game?.status === "live" && isGameOn(game) && game.players.some(player => player.memberId === policy.memberId && !player.leftAt);
}

export async function readPrivateKickoffDeliveryAuthority(eventId: string, memberId: string) {
  const wake = await readHostedMailboxWakeByDedupeKey({ dedupeKey: eventId, userId: memberId });
  const policy = wake?.kind === "assistant.notification.requested" ? wake.notification.responsePolicy : null;
  if (policy?.kind !== "game_private_kickoff" || wake?.eventId !== eventId || policy.eventId !== eventId || policy.memberId !== memberId) return null;
  return gamePrivateKickoffPolicySchema.parse(policy);
}

export async function publishPrivateKickoff(gameId: string, memberId: string, now: Date): Promise<boolean> {
  const db = getPrisma(), eventId = privateKickoffEventId(gameId, memberId);
  // A receipt reserved just before 9pm can reach here after it.
  const zone = await db.gameProfile.findUnique({ where: { memberId }, select: { timeZone: true } });
  const due = zone && morningAfter(now, zone.timeZone);
  if (!due) return false;
  if (due > now) {
    await db.hostedLinqDelivery.updateMany({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)!, status: "awaiting_generation" }, data: { retryAfterAt: due } });
    return false;
  }
  const marker = await db.gameEvent.findUnique({ where: { commandKey: activationKey(gameId, memberId) }, select: { payload: true } });
  const kind = marker?.payload && typeof marker.payload === "object" && !Array.isArray(marker.payload) ? marker.payload.messageKind : null;
  if (kind !== "new_person" && kind !== "new_rhythm") return false;
  const game = await db.game.findUnique({ where: { id: gameId }, select: { startedAt: true, status: true, players: { where: { leftAt: null }, select: { memberId: true } } } });
  if (!game?.startedAt) return false;
  const policy = gamePrivateKickoffPolicySchema.parse({ kind: "game_private_kickoff", eventId, gameId, memberId,
    messageKind: kind, expiresAt: new Date(game.startedAt.getTime() + 24 * 60 * 60_000).toISOString() });
  if (!await db.$transaction(tx => isPrivateKickoffCurrentTx(policy, tx, now))) return false;
  const projection = await readMyGameReminderProjection(memberId);
  const own = projection?.games.find(item => item.id === gameId);
  if (!own) return false;
  const destination = await resolveHostedAssistantNotificationDestination({ memberId });
  if (!destination || destination.conversationShape !== "direct-member" || destination.route.delivery.kind !== "thread"
    || destination.route.channel !== "linq") return false;
  const bound = bindHostedAssistantNotificationDestination({ destination, memberId });
  const instructions = buildGamePrivateKickoffInstructions({ messageKind: kind, task: own.task, otherFirstNames: own.otherFirstNames });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma: db, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    eventId, memberId, occurredAt: now.toISOString(), notification: { ...bound, instructions, responsePolicy: policy,
      deliveryDedupeToken: eventId, deliveryIdempotencyKey: eventId, deliveryDispatchMode: "queue-only" },
  }) });
  const appended = await db.$transaction(async tx => {
    await assertHostedDirectAssistantNotificationRouteAuthority({ authority: { channel: "linq",
      containerMemberId: memberId, threadId: destination.route.delivery.target }, prisma: tx, requireThreadDelivery: true });
    if (!await isPrivateKickoffCurrentTx(policy, tx, now)) return null;
    const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
    await tx.hostedLinqDelivery.updateMany({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)!, status: "awaiting_generation" },
      data: { status: "generation_queued", retryAfterAt: now } });
    return result;
  });
  if (appended) await signalHostedMailboxAppendRuntime({ expectedUserId: memberId, mailboxItemId: appended.mailboxItemId });
  return appended !== null;
}
