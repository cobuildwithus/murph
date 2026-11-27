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
  memberId: string;
  claimedAt: Date;
}
type Notification = Claim & { sessionId: string; request: ApplePushRequest };

/** Snapshot the intended member's enrollment in the transaction that won the claim. */
export async function prepareHealthNotification(tx: Prisma.TransactionClient, claim: Claim, isPrivateReply = false): Promise<Notification | null> {
  if (claim.memberId === claim.actor || !isHealthFeedEnabled(claim.memberId)) return null;
  const [route] = await readGamePushRoutes(tx, [claim.memberId]);
  if (!route?.gameSessionId) return null;
  const target = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true })
    .safeParse({ environment: route.environment, token: route.token, topic: route.topic });
  if (!target.success) return null;
  const { subject } = claim;
  const key = subject.kind === "comment" ? subject.commentId : claim.claimedAt.toISOString();
  const commentAlert = isPrivateReply ? "Someone replied to your comment." : "You have a new comment on your post.";
  return { ...claim, sessionId: route.gameSessionId, request: {
    target: target.data,
    collapseId: sha256Hex(`health:${subject.kind}:${claim.postId}:${key}`),
    expiresAt: new Date(claim.claimedAt.getTime() + (subject.kind === "cheer" ? CHEER_WINDOW_MS : 24 * CHEER_WINDOW_MS)),
    data: { notification: `health_${subject.kind}`, postId: claim.postId },
    message: { kind: "alert", body: subject.kind === "cheer" ? "Someone cheered your post." : commentAlert },
  } };
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
        && (comment.recipientMemberId ?? post.authorMemberId) === memberId
        && comment.pushClaimedAt?.getTime() === claimedAt.getTime();
    }
    // Withdrawing and re-adding a cheer does not revive its previous push.
    return post.authorMemberId === memberId && Boolean(await db.healthPostCheer.findFirst({ where: {
      postId, memberId: actor, createdAt: claimedAt, member: { suspendedAt: null },
      post: { deletedAt: null, cheerPushClaimedAt: claimedAt },
    }, select: { postId: true } }));
  });
}

export function sendHealthNotificationAfterCommit(notification: Notification | null): void {
  if (!notification) return;
  const task = () => deliverHealthNotification(notification);
  try { after(task); } catch { void task(); }
}
