import "server-only";

import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import { sendApplePush, type ApplePushRequest } from "../apple-push/send";
import { companionPushRouteRegistrationSchema, forgetCompanionPushRoute } from "../companion/push-route";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { isGameOn } from "./access";
import { dayIndexAt, eligibleFromDay, hasUnlockedDay, indexGameEntries, isScheduledDay, liveEntry, parseStoredTerms, type RuleState } from "./rules";
import { addDays, dayStartInstant, gameLocalDate } from "./time";

type Slot = "first" | "completion";
interface ClaimedPostNotification {
  claims: { commandKey: string; slot: Slot }[];
  gameId: string;
  actor: string;
  entryId: string;
  dayIndex: number;
  memberId: string;
  sessionId: string;
  day: string;
  completion: boolean;
  everyone: boolean;
  request: ApplePushRequest;
}

type NotificationTx = {
  companionPushRoute: Pick<Prisma.TransactionClient["companionPushRoute"], "findMany">;
  gameEvent: Pick<Prisma.TransactionClient["gameEvent"], "findMany" | "createMany">;
  gameBlock: Pick<Prisma.TransactionClient["gameBlock"], "findMany">;
};

/** Progress includes the newly inserted post. A hidden peer can never trigger completion wording. */
function milestone(state: RuleState, recipient: string, actor: string, dayIndex: number, hidden: ReadonlySet<string>) {
  const entries = indexGameEntries(state.entries);
  const eligible = state.players.filter(player => !player.leftAt && dayIndex >= eligibleFromDay(state, player));
  const peers = eligible.filter(player => player.memberId !== recipient);
  const actorPosted = peers.some(player => player.memberId === actor) && !hidden.has(actor) && !!liveEntry(entries, actor, dayIndex);
  return {
    first: actorPosted,
    completion: actorPosted && peers.every(player => !hidden.has(player.memberId) && !!liveEntry(entries, player.memberId, dayIndex)),
    everyone: !!liveEntry(entries, recipient, dayIndex),
  };
}

/** Existing GameEvent keys own both slots; caller holds the game lock. No provider work here. */
export async function claimGamePostNotification(tx: NotificationTx, input: {
  state: RuleState; actor: string; clock: Date; entryId: string; dayIndex: number;
}): Promise<ClaimedPostNotification[]> {
  const { state, actor, clock, dayIndex } = input;
  if (state.game.status !== "live" || !isGameOn({ players: state.players, invitees: state.game.invitees }) || !isScheduledDay(state, dayIndex)) return [];
  const candidate = state.entries.find(entry => entry.id === input.entryId);
  if (!candidate || candidate.memberId !== actor || candidate.attempt !== 1 || candidate.withdrawnAt || candidate.kind === "excuse") return [];
  const recipients = state.players.filter(player => player.memberId !== actor && !player.leftAt && dayIndex >= eligibleFromDay(state, player));
  if (!recipients.length) return [];
  const ids = state.players.map(player => player.memberId);
  const routes = await tx.companionPushRoute.findMany({
    where: { userId: { in: recipients.map(player => player.memberId) }, alertsAllowed: true, gameSessionId: { not: null }, member: { suspendedAt: null } },
    select: { userId: true, environment: true, token: true, topic: true, gameSessionId: true },
  });
  const blocks = await tx.gameBlock.findMany({ where: { blockerMemberId: { in: ids }, blockedMemberId: { in: ids } }, select: { blockerMemberId: true, blockedMemberId: true } });
  const pending = recipients.flatMap(recipient => {
    const route = routes.find(route => route.userId === recipient.memberId);
    const target = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true }).safeParse(route ? { environment: route.environment, token: route.token, topic: route.topic } : null);
    if (!route?.gameSessionId || !target.success) return [];
    const hidden = new Set(blocks.flatMap(block => block.blockerMemberId === recipient.memberId ? [block.blockedMemberId] : block.blockedMemberId === recipient.memberId ? [block.blockerMemberId] : []));
    const progress = milestone(state, recipient.memberId, actor, dayIndex, hidden);
    if (!progress.first) return [];
    // Real 03:00-to-03:00 day, independent of offline capture and dev clock offsets.
    const day = gameLocalDate(clock, recipient.timeZone);
    const key = `game-post:${sha256Hex(JSON.stringify([state.game.id, recipient.memberId, day]))}`;
    return [{ recipient, route, target: target.data, progress, day, key }];
  });
  if (!pending.length) return [];
  const previous = await tx.gameEvent.findMany({ where: { commandKey: { in: pending.flatMap(item => [item.key, `${item.key}:first`, `${item.key}:completion`]) } }, select: { commandKey: true } });
  const consumed = new Set(previous.map(event => event.commandKey));
  const notifications: ClaimedPostNotification[] = [];
  for (const item of pending) {
    if (consumed.has(item.key)) continue; // Legacy daily receipt consumes both slots.
    const claims = (["first", "completion"] as const).filter(slot => item.progress[slot] && !consumed.has(`${item.key}:${slot}`))
      .map(slot => ({ slot, commandKey: `${item.key}:${slot}` }));
    if (!claims.length) continue;
    const completion = claims.some(claim => claim.slot === "completion");
    const claimed = await tx.gameEvent.createMany({ skipDuplicates: true, data: claims.map(claim => ({
      gameId: state.game.id, actor: "system", type: "post_notification", commandKey: claim.commandKey,
      payload: { v: 2, recipientMemberId: item.recipient.memberId, day: item.day, slot: claim.slot, outcome: "claimed" },
    })) });
    if (claimed.count !== claims.length) continue;
    const pair = state.game.seats === 2;
    notifications.push({ claims, gameId: state.game.id, actor, entryId: input.entryId, dayIndex,
      memberId: item.recipient.memberId, sessionId: item.route.gameSessionId!, day: item.day, completion, everyone: item.progress.everyone,
      request: {
        collapseId: sha256Hex(claims[claims.length - 1]!.commandKey), data: { gameId: state.game.id, notification: "game_post" },
        expiresAt: dayStartInstant(addDays(item.day, 1), item.recipient.timeZone),
        message: { kind: "alert", title: "New game check-in", body: !pair && completion
          ? item.progress.everyone ? "Everyone's in." : "Everyone's in but you."
          : hasUnlockedDay(state.entries, item.recipient.memberId, dayIndex) ? "There's a new post in your game. Take a look." : "Someone posted. Share yours to see it." },
        target: item.target,
      },
    });
  }
  return notifications;
}

/** A push never holds up the committed post's HTTP answer. */
export function sendGamePostNotificationAfterResponse(notifications: readonly ClaimedPostNotification[]): void {
  if (!notifications.length) return;
  const task = async () => { for (const notification of notifications) await deliverGamePostNotification(notification); };
  try { after(task); } catch { void task(); }
}

/** Best effort, one attempt. A stale or ambiguous send never releases its claims. */
export async function deliverGamePostNotification(notification: ClaimedPostNotification): Promise<void> {
  let outcome = "failed";
  try {
    const db = getPrisma();
    const current = await db.companionPushRoute.findFirst({
      where: { userId: notification.memberId, ...notification.request.target, alertsAllowed: true, gameSessionId: notification.sessionId,
        member: { suspendedAt: null, authRecords: { some: { model: "session", id: notification.sessionId, expiresAt: { gt: new Date() } } } } },
      select: { userId: true },
    });
    if (!current || notification.request.expiresAt.getTime() <= Date.now() || !await stillValid(notification)) outcome = "superseded";
    else {
      outcome = await sendApplePush(notification.request);
      if (outcome === "unregistered") await forgetCompanionPushRoute(notification.memberId, notification.request.target.token);
    }
  } catch { /* Optional delivery cannot turn a committed post into an error. */ }
  try {
    for (const claim of notification.claims) await getPrisma().gameEvent.updateMany({ where: { commandKey: claim.commandKey },
      data: { payload: { v: 2, recipientMemberId: notification.memberId, day: notification.day, slot: claim.slot, outcome } } });
  } catch { /* A remaining claimed receipt still prevents replay. */ }
}

async function stillValid(notification: ClaimedPostNotification): Promise<boolean> {
  const db = getPrisma();
  const row = await db.game.findUnique({ where: { id: notification.gameId }, include: {
    invitees: { select: { memberId: true } },
    players: { include: { entries: { where: { dayIndex: notification.dayIndex }, select: {
      id: true, memberId: true, dayIndex: true, attempt: true, withdrawnAt: true, receivedAt: true,
    } } } },
  } });
  if (!row || row.status !== "live" || !isGameOn(row)) return false;
  const recipient = row.players.find(player => player.memberId === notification.memberId && !player.leftAt);
  if (!recipient?.timeZone || gameLocalDate(new Date(), recipient.timeZone) !== notification.day) return false;
  const entries = row.players.flatMap(player => player.entries);
  const candidate = entries.find(entry => entry.id === notification.entryId && !entry.withdrawnAt);
  if (!candidate || candidate.memberId !== notification.actor) return false;
  if (await db.gameReport.findFirst({ where: { reporterMemberId: notification.memberId, entryId: notification.entryId }, select: { id: true } })) return false;
  const blocks = await db.gameBlock.findMany({ where: { OR: [{ blockerMemberId: notification.memberId, blockedMemberId: { in: row.players.flatMap(player => player.memberId ?? []) } }, { blockedMemberId: notification.memberId, blockerMemberId: { in: row.players.flatMap(player => player.memberId ?? []) } }] }, select: { blockerMemberId: true, blockedMemberId: true } });
  const hidden = new Set(blocks.map(block => block.blockerMemberId === notification.memberId ? block.blockedMemberId : block.blockerMemberId));
  // Reuse the canonical row conversion and milestone policy; no decrypted content is loaded.
  const state: RuleState = { game: { id: row.id, seats: row.maxPlayers, status: "live", createdBy: row.createdBy, lengthDays: row.lengthDays,
    startsOn: row.startsOn?.toISOString().slice(0, 10) ?? null, inviteExpiresAt: row.inviteExpiresAt, terms: parseStoredTerms(row.terms) },
    players: row.players.flatMap(player => player.memberId && player.timeZone ? [{ ...player, memberId: player.memberId, timeZone: player.timeZone, dayOne: player.dayOne?.toISOString().slice(0, 10) ?? null }] : []),
    entries: entries.map(entry => ({ ...entry, kind: entry.attempt === 0 ? "excuse" : "photo", mediaKeys: [], blurHash: null })),
  };
  const effectiveNow = new Date(Date.now() + Number(row.devClockOffsetMs));
  if (row.maxPlayers === 10 && dayIndexAt(state.players.find(player => player.memberId === notification.memberId)!, effectiveNow) !== notification.dayIndex) return false;
  const progress = milestone(state, notification.memberId, notification.actor, notification.dayIndex, hidden);
  return progress.first && (!notification.completion || progress.completion && (row.maxPlayers === 2 || progress.everyone === notification.everyone));
}
