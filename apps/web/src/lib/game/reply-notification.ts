import "server-only";

import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import type { ApplePushRequest } from "../apple-push/send";
import { companionPushRouteRegistrationSchema } from "../companion/push-route";
import { sha256Hex } from "../primitives";
import { deliverGamePush, readGamePushRoutes } from "./push-delivery";
import { readPushName } from "./viewer-names";

export interface ClaimedReplyNotification {
  commandKey: string;
  gameId: string;
  replyId: string;
  /** Who replied. */
  actor: string;
  kind: "text" | "voice";
  memberId: string;
  sessionId: string;
  request: ApplePushRequest;
}

/** The slot belongs to the post forever, including delete/re-reply and missing push enrollment. */
export async function claimGameReplyNotification(tx: {
  gameEvent: Pick<Prisma.TransactionClient["gameEvent"], "createMany">;
  companionPushRoute: Pick<Prisma.TransactionClient["companionPushRoute"], "findMany">;
}, input: {
  gameId: string; entryId: string; replyId: string; actor: string; memberId: string; kind: "text" | "voice";
}): Promise<ClaimedReplyNotification | null> {
  const commandKey = `game-reply-push:${input.entryId}`;
  const claim = await tx.gameEvent.createMany({ skipDuplicates: true, data: [{
    gameId: input.gameId, actor: "system", type: "reply_notification", commandKey, payload: { entryId: input.entryId },
  }] });
  if (!claim.count) return null;
  const [route] = await readGamePushRoutes(tx, [input.memberId]);
  const target = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true }).safeParse(route ? { environment: route.environment, token: route.token, topic: route.topic } : null);
  if (!route?.gameSessionId || !target.success) return null;
  return { commandKey, gameId: input.gameId, replyId: input.replyId, actor: input.actor, kind: input.kind, memberId: input.memberId, sessionId: route.gameSessionId,
    request: { collapseId: sha256Hex(commandKey), data: { gameId: input.gameId, notification: "game_reply" },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), target: target.data, message: replyMessage(input.kind, null) } };
}

/** Names who replied as the recipient knows them, never what they said. */
function replyMessage(kind: "text" | "voice", name: string | null) {
  if (!name) return { kind: "alert", body: kind === "voice" ? "New voice note on your post." : "New note on your post." } as const;
  return { kind: "alert", body: kind === "voice" ? `${name} replied with a voice note.` : `${name} replied to your post.` } as const;
}

export function sendGameReplyNotificationAfterResponse(notification: ClaimedReplyNotification | null): void {
  if (!notification) return;
  const task = () => deliverGameReplyNotification(notification);
  try { after(task); } catch { void task(); }
}

export async function deliverGameReplyNotification(notification: ClaimedReplyNotification): Promise<void> {
  // Expiration is relative to this one send, not the time the transaction began.
  notification.request.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await deliverGamePush(notification, async () => {
    const { canReadGameReply } = await import("./service");
    if (!await canReadGameReply(notification.gameId, notification.replyId, notification.memberId)) return false;
    notification.request.message = replyMessage(notification.kind, await readPushName(notification.memberId, notification.actor));
    return true;
  });
}
