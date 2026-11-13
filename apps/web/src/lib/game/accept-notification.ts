import "server-only";

import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import type { ApplePushRequest } from "../apple-push/send";
import { companionPushRouteRegistrationSchema } from "../companion/push-route";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { isGameEnabled } from "./access";
import { deliverGamePush, readGamePushRoutes } from "./push-delivery";
import type { Schedule } from "./rules";
import { addDays, daysBetween, dayStartInstant } from "./time";

interface PreparedAcceptNotification {
  gameId: string;
  actor: string;
  memberId: string;
  sessionId: string;
  request: ApplePushRequest;
}

/**
 * Only the accept that takes a pair game live calls this, under the game lock, so it runs once
 * per game: a repeated accept is already joined and never gets here. No route now means no push.
 */
export async function prepareGameAcceptNotification(tx: {
  companionPushRoute: Pick<Prisma.TransactionClient["companionPushRoute"], "findMany">;
}, input: {
  gameId: string; maxPlayers: number; actor: string; schedule: Schedule; clock: Date;
}): Promise<PreparedAcceptNotification | null> {
  if (input.maxPlayers !== 2) return null;
  const recipient = input.schedule.players.find(player => player.memberId !== input.actor);
  if (!recipient) return null;
  const [route] = await readGamePushRoutes(tx, [recipient.memberId]);
  const target = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true }).safeParse(route ? { environment: route.environment, token: route.token, topic: route.topic } : null);
  if (!route?.gameSessionId || !target.success) return null;
  // Calendar date at the real clock, not the 03:00 game date or dev clock.
  const today = formatTimeZoneDateTimeParts(input.clock, recipient.timeZone).dayKey;
  const days = daysBetween(today, recipient.dayOne);
  const start = days === 0 ? "today" : days === 1 ? "tomorrow" : new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", ...(days >= 2 && days <= 6 ? { weekday: "long" } as const : { month: "short", day: "numeric" } as const),
  }).format(new Date(`${recipient.dayOne}T00:00:00Z`));
  return { gameId: input.gameId, actor: input.actor, memberId: recipient.memberId, sessionId: route.gameSessionId,
    request: { collapseId: sha256Hex(`game-accept-push:${input.gameId}`), data: { gameId: input.gameId, notification: "game_accepted" }, target: target.data,
      expiresAt: dayStartInstant(addDays(today, 1), recipient.timeZone),
      message: { kind: "alert", title: "They shook on it.", body: `Your game starts ${start}.` } } };
}

export function sendGameAcceptNotificationAfterResponse(notification: PreparedAcceptNotification | null): void {
  if (!notification) return;
  const task = () => deliverGameAcceptNotification(notification);
  try { after(task); } catch { void task(); }
}

export async function deliverGameAcceptNotification(notification: PreparedAcceptNotification): Promise<void> {
  await deliverGamePush(notification, async () => {
    const db = getPrisma();
    const row = await db.game.findUnique({ where: { id: notification.gameId }, select: {
      status: true, players: { select: { memberId: true, leftAt: true } },
    } });
    if (!row || row.status !== "live" || !isGameEnabled()
      || !row.players.some(player => player.memberId === notification.memberId && !player.leftAt)) return false;
    return !await db.gameBlock.findFirst({ where: { OR: [
      { blockerMemberId: notification.memberId, blockedMemberId: notification.actor },
      { blockerMemberId: notification.actor, blockedMemberId: notification.memberId },
    ] }, select: { blockerMemberId: true } });
  });
}
