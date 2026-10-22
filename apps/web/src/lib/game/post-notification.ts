import "server-only";

import type { GamePlayer, Prisma } from "@prisma/client";
import { sendApplePush, type ApplePushRequest } from "../apple-push/send";
import { companionPushRouteRegistrationSchema, forgetCompanionPushRoute } from "../companion/push-route";
import { sha256Hex } from "../primitives";
import { getPrisma } from "../prisma";
import { isGameEnabledFor } from "./access";
import { hasUnlockedDay, type RuleEntry } from "./rules";
import { addDays, dayStartInstant, gameLocalDate } from "./time";

interface ClaimedPostNotification {
  commandKey: string;
  memberId: string;
  sessionId: string;
  day: string;
  request: ApplePushRequest;
}

/**
 * The existing game event owns the effect identity. Claim inside the posting
 * transaction; send only after commit. One address per member, one opponent in
 * the current 1v1 game. No names, photos, tasks or entry text enter the push.
 */
export async function claimGamePostNotification(
  tx: {
    companionPushRoute: Pick<Prisma.TransactionClient["companionPushRoute"], "findFirst">;
    gameEvent: Pick<Prisma.TransactionClient["gameEvent"], "createMany">;
  },
  input: {
    gameId: string; actor: string; players: readonly GamePlayer[]; clock: Date;
    entries: readonly RuleEntry[]; dayIndex: number;
  },
): Promise<ClaimedPostNotification | null> {
  if (input.players.length !== 2 || !isGameEnabledFor(input.actor)) return null;
  const recipient = input.players.find((player) => player.memberId !== input.actor);
  if (!recipient || !isGameEnabledFor(recipient.memberId)) return null;
  const route = await tx.companionPushRoute.findFirst({
    where: { userId: recipient.memberId, alertsAllowed: true, gameSessionId: { not: null }, member: { suspendedAt: null } },
    select: { environment: true, token: true, topic: true, gameSessionId: true },
  });
  if (!route?.gameSessionId) return null;
  const target = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true })
    .safeParse({ environment: route.environment, token: route.token, topic: route.topic });
  if (!target.success) return null;
  // Use the recipient's real game day, not the entry's day (offline grace may
  // accept yesterday's entry) or the development time-travel clock.
  const day = gameLocalDate(input.clock, recipient.timeZone);
  const commandKey = `game-post:${sha256Hex(JSON.stringify([input.gameId, recipient.memberId, day]))}`;
  const claimed = await tx.gameEvent.createMany({
    data: [{
      gameId: input.gameId, actor: "system", type: "post_notification", commandKey,
      payload: { v: 1, recipientMemberId: recipient.memberId, day, outcome: "claimed" },
    }],
    skipDuplicates: true,
  });
  if (claimed.count !== 1) return null;
  return {
    commandKey, memberId: recipient.memberId, sessionId: route.gameSessionId, day,
    request: {
      collapseId: sha256Hex(commandKey),
      data: { gameId: input.gameId, notification: "game_post" },
      expiresAt: dayStartInstant(addDays(day, 1), recipient.timeZone),
      message: {
        kind: "alert", title: "New game check-in",
        body: hasUnlockedDay(input.entries, recipient.memberId, input.dayIndex)
          ? "There's a new post in your game. Take a look."
          : "Someone posted. Share yours to see it.",
      },
      target: target.data,
    },
  };
}

/** Best effort, at most one attempt: an ambiguous APNs failure never frees the daily claim. */
export async function deliverGamePostNotification(notification: ClaimedPostNotification | null): Promise<void> {
  if (!notification) return;
  let outcome = "failed";
  try {
    // Honor permission revocation, sign-out, suspension and token replacement
    // between the game commit and the external effect.
    const current = await getPrisma().companionPushRoute.findFirst({
      where: {
        userId: notification.memberId, ...notification.request.target,
        alertsAllowed: true, gameSessionId: notification.sessionId,
        member: {
          suspendedAt: null,
          authRecords: { some: { model: "session", id: notification.sessionId, expiresAt: { gt: new Date() } } },
        },
      },
      select: { userId: true },
    });
    if (!current || !isGameEnabledFor(notification.memberId) || notification.request.expiresAt.getTime() <= Date.now()) {
      outcome = "superseded";
    } else {
      outcome = await sendApplePush(notification.request);
      if (outcome === "unregistered") await forgetCompanionPushRoute(notification.memberId, notification.request.target.token);
    }
  } catch {
    // A notification failure must never turn a committed check-in into an error.
  }
  try {
    await getPrisma().gameEvent.updateMany({
      where: { commandKey: notification.commandKey },
      data: { payload: { v: 1, recipientMemberId: notification.memberId, day: notification.day, outcome } },
    });
  } catch {
    // A remaining claimed receipt still prevents replay after uncertain delivery.
  }
}
