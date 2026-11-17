import "server-only";

import { Prisma } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { buildGamePrivateEveningInstructions, gamePrivateEveningCheckInPolicySchema, type HostedGamePrivateEveningCheckInPolicy } from "@murphai/hosted-execution/runtime-control";
import { buildHostedLinqDeliveryId } from "../hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
import { assertHostedDirectAssistantNotificationRouteAuthority, bindHostedAssistantNotificationDestination, resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import { isGameEnabled } from "./access";
import { readMyGameReminderProjection } from "./direct-tool";
import { roomCoversEveningGame } from "./evening-check-in";
import { gameReminderWindow, reminderOpenDay } from "./reminders";
import { currentTerms } from "./rules";
import { canTextGameReminders, loadGameMissedCheckInGames } from "./service";
import { addDays } from "./time";

const WINDOW_MS = 30 * 60_000;
const MAX_GAMES = 20;
const enabled = () => process.env.MURPH_GAME_PRIVATE_REMINDERS_ENABLED === "true";
/** One text a day for each reminder time: the games at that time, an hour after it. */
export const privateEveningEventId = (memberId: string, date: string, minutes: number) => `game-evening-private:${memberId}:${date}:${minutes}`;
const eventMinutes = (eventId: string) => Number(eventId.slice(eventId.lastIndexOf(":") + 1));

async function currentEvening(memberId: string, date: string, minutes: number, now: Date, db: Prisma.TransactionClient | ReturnType<typeof getPrisma>) {
  if (!enabled() || !await canTextGameReminders(memberId, db)) return null;
  const profile = await db.gameProfile.findUnique({ where: { memberId }, select: { reminderMinutes: true, reminderText: true, timeZone: true } });
  if (!profile?.reminderText) return null;
  const window = gameReminderWindow(now, profile.timeZone, (minutes + 60) % 1440);
  if (!window || window.day !== date) return null;
  const live = await db.gamePlayer.findMany({ where: { memberId, leftAt: null, reminderOff: false, game: { status: "live" } },
    select: { gameId: true, reminderEveryDay: true, reminderMinutes: true }, orderBy: { gameId: "asc" }, take: MAX_GAMES + 1 });
  if (live.length > MAX_GAMES) return null;
  const seats = live.filter(seat => (seat.reminderMinutes ?? profile.reminderMinutes) === minutes);
  const loaded = await loadGameMissedCheckInGames(db, seats.map(seat => seat.gameId));
  const batch = [];
  for (const game of loaded) {
    const seat = seats.find(seat => seat.gameId === game.row.id);
    const player = game.state.players.find(player => player.memberId === memberId && !player.leftAt);
    if (!seat || !player || !isGameEnabled() || await roomCoversEveningGame(game.row.chatContainerMemberId, game.row.id, now)) continue;
    const dayIndex = reminderOpenDay(game.state, player, new Date(now.getTime() + Number(game.row.devClockOffsetMs)), seat.reminderEveryDay);
    if (dayIndex !== null) batch.push({ gameId: game.row.id, termsVersion: currentTerms(game.state.game.terms).n, dayIndex });
  }
  return batch.length ? { batch, expiresAt: window.expiresAt } : null;
}

/**
 * Three accepted private texts with no reply since, within four weeks and at any of their times, pause them until they write.
 * Their published wakes keep the event ids: dispatch rewrites a receipt's template and source, never its idempotency key.
 */
async function privateEveningPaused(memberId: string, date: string, tx: Prisma.TransactionClient) {
  const wakes = await tx.hostedMailboxItem.findMany({ where: { userId: memberId, dedupeKey: { startsWith: `game-evening-private:${memberId}:` },
    createdAt: { gte: new Date(`${addDays(date, -28)}T00:00:00Z`) } }, orderBy: { createdAt: "desc" }, take: 30, select: { dedupeKey: true } });
  if (wakes.length < 3) return false;
  const latest = await tx.hostedLinqDelivery.findMany({ where: { acceptedAt: { not: null },
    idempotencyKey: { in: wakes.map(wake => createHostedLinqDeliveryIdempotencyLookupKey(wake.dedupeKey)!) } },
    orderBy: { acceptedAt: "desc" }, take: 3, select: { acceptedAt: true } });
  if (latest.length < 3) return false;
  const since = latest[2]!.acceptedAt!;
  const inbound = await tx.hostedMailboxItem.findFirst({ where: { userId: memberId, kind: "conversation.message", lane: "conversation", occurredAt: { gte: since } }, select: { id: true } });
  return !inbound;
}

/** One receipt per member, profile-local reminder date and reminder time. */
export async function reserveDuePrivateEveningCheckIns(now = new Date(), options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<number> {
  if (!enabled()) return 0;
  const db = getPrisma();
  const shard = Math.floor(now.getTime() / 60_000) % 5;
  let cursor = "", reserved = 0;
  while (!options.signal?.aborted && Date.now() < (options.deadlineMs ?? Infinity)) {
    const profiles = await db.$queryRaw<Array<{ memberId: string; timeZone: string; slots: number[] }>>`
      SELECT profile.member_id AS "memberId", profile.time_zone AS "timeZone",
        array_agg(DISTINCT COALESCE(seat.reminder_minutes, profile.reminder_minutes)) AS "slots"
      FROM game_profile profile
      JOIN game_player seat ON seat.member_id = profile.member_id AND seat.left_at IS NULL AND NOT seat.reminder_off
      JOIN game ON game.id = seat.game_id AND game.status = 'live'
      WHERE profile.member_id > ${cursor} AND profile.reminder_text
        AND mod(abs(hashtext(profile.member_id)::bigint), 5) = ${shard}
      GROUP BY profile.member_id, profile.time_zone
      ORDER BY profile.member_id LIMIT 100`;
    if (!profiles.length) break;
    cursor = profiles[profiles.length - 1]!.memberId;
    for (const profile of profiles) for (const minutes of profile.slots) {
      if (options.signal?.aborted || Date.now() >= (options.deadlineMs ?? Infinity)) break;
      const date = gameReminderWindow(now, profile.timeZone, (minutes + 60) % 1440)?.day;
      if (!date) continue;
      const current = await currentEvening(profile.memberId, date, minutes, now, db);
      if (!current) continue;
      const eventId = privateEveningEventId(profile.memberId, date, minutes), key = createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
      const created = await db.$transaction(async tx => {
        if (!await currentEvening(profile.memberId, date, minutes, now, tx) || await privateEveningPaused(profile.memberId, date, tx)) return false;
        const row = await tx.hostedLinqDelivery.createMany({ data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
          source: "game_lifecycle", sourceRef: `${profile.memberId}:${date}:${minutes}`, template: "game_private_evening", status: "awaiting_generation",
          targetKind: "thread", payloadOwnerMemberId: profile.memberId, attemptedAt: now, retryAfterAt: now, createdAt: now }], skipDuplicates: true });
        return row.count === 1;
      });
      if (created) reserved += 1;
    }
    if (profiles.length < 100) break;
  }
  return reserved;
}

export async function isPrivateEveningCurrentTx(policy: HostedGamePrivateEveningCheckInPolicy, tx: Prisma.TransactionClient, now: Date) {
  if (now >= new Date(policy.expiresAt)) return false;
  const current = await currentEvening(policy.memberId, policy.date, eventMinutes(policy.eventId), now, tx);
  if (current?.expiresAt.toISOString() !== policy.expiresAt || JSON.stringify(current.batch) !== JSON.stringify(policy.batch)) return false;
  return !await privateEveningPaused(policy.memberId, policy.date, tx);
}

export async function readPrivateEveningDeliveryAuthority(eventId: string, memberId: string) {
  const wake = await readHostedMailboxWakeByDedupeKey({ dedupeKey: eventId, userId: memberId });
  const policy = wake?.kind === "assistant.notification.requested" ? wake.notification.responsePolicy : null;
  if (policy?.kind !== "game_private_evening_check_in" || wake?.eventId !== eventId || policy.eventId !== eventId || policy.memberId !== memberId) return null;
  return gamePrivateEveningCheckInPolicySchema.parse(policy);
}

export async function publishPrivateEveningCheckIn(memberId: string, date: string, minutes: number, now: Date): Promise<boolean> {
  const db = getPrisma(), eventId = privateEveningEventId(memberId, date, minutes);
  const current = await currentEvening(memberId, date, minutes, now, db);
  if (!current) return false;
  const policy = gamePrivateEveningCheckInPolicySchema.parse({ kind: "game_private_evening_check_in", eventId, memberId, date,
    expiresAt: current.expiresAt.toISOString(), conversationLaneSeq: "0", batch: current.batch });
  const projection = await readMyGameReminderProjection(memberId);
  const games = projection?.games.filter(game => policy.batch.some(item => item.gameId === game.id)) ?? [];
  if (games.length !== policy.batch.length) return false;
  const destination = await resolveHostedAssistantNotificationDestination({ memberId });
  if (!destination || destination.conversationShape !== "direct-member" || destination.route.delivery.kind !== "thread"
    || destination.route.channel !== "linq") return false;
  const bound = bindHostedAssistantNotificationDestination({ destination, memberId });
  const instructions = buildGamePrivateEveningInstructions({ tasks: games.map(game => game.task) });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ prisma: db, envelope: buildHostedExecutionAssistantNotificationRequestedWake({
    eventId, memberId, occurredAt: now.toISOString(), notification: { ...bound, instructions, responsePolicy: policy,
      deliveryDedupeToken: eventId, deliveryIdempotencyKey: eventId, deliveryDispatchMode: "queue-only" },
  }) });
  const appended = await db.$transaction(async tx => {
    await assertHostedDirectAssistantNotificationRouteAuthority({ authority: { channel: "linq",
      containerMemberId: memberId, threadId: destination.route.delivery.target }, prisma: tx, requireThreadDelivery: true });
    if (!await isPrivateEveningCurrentTx(policy, tx, now)) return null;
    const result = await appendPreparedHostedMailboxEnvelopeTx({ prepared, tx });
    await tx.hostedLinqDelivery.updateMany({ where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(eventId)!, status: "awaiting_generation" },
      data: { status: "generation_queued", retryAfterAt: now } });
    return result;
  });
  if (appended) await signalHostedMailboxAppendRuntime({ expectedUserId: memberId, mailboxItemId: appended.mailboxItemId });
  return appended !== null;
}
