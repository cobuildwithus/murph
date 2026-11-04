import "server-only";

import type { Prisma } from "@prisma/client";
import { sendApplePush, type ApplePushRequest } from "../apple-push/send";
import { forgetCompanionPushRoute } from "../companion/push-route";
import { getPrisma } from "../prisma";

export function readGamePushRoutes(db: { companionPushRoute: Pick<Prisma.TransactionClient["companionPushRoute"], "findMany"> }, members: string[]) {
  return db.companionPushRoute.findMany({
    where: { userId: { in: members }, alertsAllowed: true, gameSessionId: { not: null }, member: { suspendedAt: null } },
    select: { userId: true, environment: true, token: true, topic: true, gameSessionId: true },
  });
}

/** One best-effort attempt; each notification owner supplies its current subject authority. */
export async function deliverGamePush(notification: { memberId: string; sessionId: string; request: ApplePushRequest }, stillValid: () => Promise<boolean>): Promise<string> {
  try {
    const current = await getPrisma().companionPushRoute.findFirst({
      where: { userId: notification.memberId, ...notification.request.target, alertsAllowed: true, gameSessionId: notification.sessionId,
        member: { suspendedAt: null, authRecords: { some: { model: "session", id: notification.sessionId, expiresAt: { gt: new Date() } } } } },
      select: { userId: true },
    });
    if (!current || notification.request.expiresAt.getTime() <= Date.now() || !await stillValid()) return "superseded";
    const outcome = await sendApplePush(notification.request);
    if (outcome === "unregistered") await forgetCompanionPushRoute(notification.memberId, notification.request.target.token);
    return outcome;
  } catch { return "failed"; }
}
