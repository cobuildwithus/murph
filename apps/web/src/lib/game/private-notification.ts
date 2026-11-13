import "server-only";

import { Prisma } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { buildGamePrivateEveningInstructions, gamePrivateEveningCheckInPolicySchema, type HostedGamePrivateEveningCheckInPolicy } from "@murphai/hosted-execution/runtime-control";
import { buildHostedLinqDeliveryId } from "../hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { acquireHostedMailboxCausalAppendLockTx, appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend, readHostedMailboxMaxSeqByLane, readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
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
export const privateEveningEventId = (memberId: string, date: string) => `game-evening-private:${memberId}:${date}`;

async function currentEvening(memberId: string, date: string, now: Date, db: Prisma.TransactionClient | ReturnType<typeof getPrisma>) {
  if (!enabled() || !await canTextGameReminders(memberId, db)) return null;
  const profile = await db.gameProfile.findUnique({ where: { memberId }, select: { reminderMinutes: true, reminderText: true, timeZone: true } });
  if (!profile?.reminderText) return null;
  const window = gameReminderWindow(now, profile.timeZone, (profile.reminderMinutes + 60) % 1440);
  if (!window || window.day !== date) return null;
  const seats = await db.gamePlayer.findMany({ where: { memberId, leftAt: null, reminderOff: false, game: { status: "live" } },
    select: { gameId: true, reminderEveryDay: true }, orderBy: { gameId: "asc" }, take: MAX_GAMES + 1 });
  if (seats.length > MAX_GAMES) return null;
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

async function privateEveningPaused(memberId: string, date: string, tx: Prisma.TransactionClient) {
  const previous = Array.from({ length: 28 }, (_, index) => addDays(date, -index - 1));
  const keys = previous.map(day => createHostedLinqDeliveryIdempotencyLookupKey(privateEveningEventId(memberId, day))!);
  const accepted = await tx.hostedLinqDelivery.findMany({ where: { idempotencyKey: { in: keys }, acceptedAt: { not: null } }, select: { idempotencyKey: true, acceptedAt: true } });
  const latest = previous.map(day => accepted.find(row => row.idempotencyKey === createHostedLinqDeliveryIdempotencyLookupKey(privateEveningEventId(memberId, day))))
    .filter((row): row is NonNullable<typeof row> => Boolean(row)).slice(0, 3);
  if (latest.length < 3) return false;
  const since = latest[2]!.acceptedAt!;
  const inbound = await tx.hostedMailboxItem.findFirst({ where: { userId: memberId, kind: "conversation.message", lane: "conversation", occurredAt: { gte: since } }, select: { id: true } });
  return !inbound;
}

/** One receipt per member and profile-local reminder date. */
export async function reserveDuePrivateEveningCheckIns(now = new Date(), options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<number> {
  if (!enabled()) return 0;
  const db = getPrisma();
  const shard = Math.floor(now.getTime() / 60_000) % 5;
  let cursor = "", reserved = 0;
  while (!options.signal?.aborted && Date.now() < (options.deadlineMs ?? Infinity)) {
    const profiles = await db.$queryRaw<Array<{ memberId: string; timeZone: string; reminderMinutes: number }>>`
      SELECT member_id AS "memberId", time_zone AS "timeZone", reminder_minutes AS "reminderMinutes"
      FROM game_profile WHERE member_id > ${cursor} AND reminder_text
        AND mod(abs(hashtext(member_id)::bigint), 5) = ${shard}
        AND EXISTS (SELECT 1 FROM game_player seat JOIN game ON game.id = seat.game_id
          WHERE seat.member_id = game_profile.member_id AND seat.left_at IS NULL AND NOT seat.reminder_off AND game.status = 'live')
      ORDER BY member_id LIMIT 100`;
    if (!profiles.length) break;
    cursor = profiles[profiles.length - 1]!.memberId;
    for (const profile of profiles) {
      if (options.signal?.aborted || Date.now() >= (options.deadlineMs ?? Infinity)) break;
      const date = gameReminderWindow(now, profile.timeZone, (profile.reminderMinutes + 60) % 1440)?.day;
      if (!date) continue;
      const current = await currentEvening(profile.memberId, date, now, db);
      if (!current) continue;
      const eventId = privateEveningEventId(profile.memberId, date), key = createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
      const created = await db.$transaction(async tx => {
        if (!await currentEvening(profile.memberId, date, now, tx) || await privateEveningPaused(profile.memberId, date, tx)) return false;
        const row = await tx.hostedLinqDelivery.createMany({ data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
          source: "game_lifecycle", sourceRef: `${profile.memberId}:${date}`, template: "game_private_evening", status: "awaiting_generation",
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
  const current = await currentEvening(policy.memberId, policy.date, now, tx);
  if (current?.expiresAt.toISOString() !== policy.expiresAt || JSON.stringify(current.batch) !== JSON.stringify(policy.batch)) return false;
  if (await privateEveningPaused(policy.memberId, policy.date, tx)) return false;
  await acquireHostedMailboxCausalAppendLockTx({ tx, userId: policy.memberId });
  const [watermark] = await readHostedMailboxMaxSeqByLane({ prisma: tx, userId: policy.memberId, lanes: ["conversation"] });
  return watermark.maxSeq === policy.conversationLaneSeq;
}

export async function readPrivateEveningDeliveryAuthority(eventId: string, memberId: string) {
  const wake = await readHostedMailboxWakeByDedupeKey({ dedupeKey: eventId, userId: memberId });
  const policy = wake?.kind === "assistant.notification.requested" ? wake.notification.responsePolicy : null;
  if (policy?.kind !== "game_private_evening_check_in" || wake?.eventId !== eventId || policy.eventId !== eventId || policy.memberId !== memberId) return null;
  return gamePrivateEveningCheckInPolicySchema.parse(policy);
}

export async function publishPrivateEveningCheckIn(memberId: string, date: string, now: Date): Promise<boolean> {
  const db = getPrisma(), eventId = privateEveningEventId(memberId, date);
  const current = await currentEvening(memberId, date, now, db);
  if (!current) return false;
  const [watermark] = await readHostedMailboxMaxSeqByLane({ userId: memberId, lanes: ["conversation"] });
  const policy = gamePrivateEveningCheckInPolicySchema.parse({ kind: "game_private_evening_check_in", eventId, memberId, date,
    expiresAt: current.expiresAt.toISOString(), conversationLaneSeq: watermark.maxSeq, batch: current.batch });
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
