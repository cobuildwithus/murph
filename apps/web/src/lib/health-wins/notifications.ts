import "server-only";
import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import type { ApplePushRequest } from "../apple-push/send";
import { companionPushRouteRegistrationSchema } from "../companion/push-route";
import { deliverGamePush, readGamePushRoutes } from "../game/push-delivery";
import { getPrisma } from "../prisma";
import { sha256Hex } from "../primitives";
import { findVisibleHealthComment, findVisibleHealthPost } from "./audience";
import { isHealthFeedEnabled } from "./flag";

export const CHEER_WINDOW_MS = 60 * 60_000;

type Subject = { kind: "cheer" } | { kind: "comment"; commentId: string };
interface Claim {
  subject: Subject;
  actor: string;
  postId: string;
  claimedAt: Date;
}
type Target = { memberId: string; reason: "reply" | "comment" | "cheer" };
type Notification = Claim & Target & { sessionId: string; request: ApplePushRequest };

export function commentNotificationTargets(actor: string, poster: string, parentAuthor: string | null, recipient: string | null) {
  const targets: Target[] = [];
  const replyTo = parentAuthor ?? recipient; // Historical private answers have no parent link.
  if (replyTo && replyTo !== actor) targets.push({ memberId: replyTo, reason: "reply" });
  if (poster !== actor && poster !== replyTo) targets.push({ memberId: poster, reason: "comment" });
  return targets;
}

const alerts = {
  cheer: "Someone cheered your post.",
  reply: "Someone replied to your comment.",
  comment: "You have a new comment on your post.",
};

/** Snapshot each intended member's enrollment in the transaction that won the claim. */
export async function prepareHealthNotifications(tx: Prisma.TransactionClient, claim: Claim, targets: Target[]): Promise<Notification[]> {
  const eligible = targets.filter(target => isHealthFeedEnabled(target.memberId));
  if (!eligible.length) return [];
  const routes = await readGamePushRoutes(tx, eligible.map(target => target.memberId));
  const { subject } = claim;
  const key = subject.kind === "comment" ? subject.commentId : claim.claimedAt.toISOString();
  return routes.flatMap(route => {
    const target = eligible.find(target => target.memberId === route.userId);
    if (!target || !route.gameSessionId) return [];
    const address = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true })
      .safeParse({ environment: route.environment, token: route.token, topic: route.topic });
    if (!address.success) return [];
    return [{ ...claim, ...target, sessionId: route.gameSessionId, request: {
      target: address.data,
      collapseId: sha256Hex(`health:${subject.kind}:${claim.postId}:${key}`),
      expiresAt: new Date(claim.claimedAt.getTime() + (subject.kind === "cheer" ? CHEER_WINDOW_MS : 24 * CHEER_WINDOW_MS)),
      data: { notification: `health_${subject.kind}`, postId: claim.postId, ...(subject.kind === "comment" && { commentId: subject.commentId }) },
      message: { kind: "alert", body: alerts[target.reason] },
    } }];
  });
}

export async function deliverHealthNotification(notification: Notification): Promise<void> {
  const { actor, postId, memberId, claimedAt, subject } = notification;
  await deliverGamePush(notification, async () => {
    if (!isHealthFeedEnabled(memberId) || !isHealthFeedEnabled(actor)) return false;
    const db = getPrisma();
    const post = await findVisibleHealthPost(db, actor, postId);
    if (!post) return false;
    if (subject.kind === "comment") {
      const comment = await findVisibleHealthComment(db, memberId, subject.commentId);
      return comment?.postId === postId && comment.authorMemberId === actor
        && commentNotificationTargets(actor, post.authorMemberId, comment.parentAuthorId, comment.recipientMemberId)
          .some(target => target.memberId === memberId && target.reason === notification.reason)
        && comment.pushClaimedAt?.getTime() === claimedAt.getTime();
    }
    // Withdrawing and re-adding a cheer does not revive its previous push.
    return post.authorMemberId === memberId && Boolean(await db.healthPostCheer.findFirst({ where: {
      postId, memberId: actor, createdAt: claimedAt, member: { suspendedAt: null },
      post: { deletedAt: null, cheerPushClaimedAt: claimedAt },
    }, select: { postId: true } }));
  });
}

export function sendHealthNotificationsAfterCommit(notifications: Notification[]): void {
  if (!notifications.length) return;
  const task = async () => { await Promise.all(notifications.map(deliverHealthNotification)); };
  try { after(task); } catch { void task(); }
}
