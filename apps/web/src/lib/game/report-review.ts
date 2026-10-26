import "server-only";

import { GAME_ENTRY_KINDS, GAME_REPORT_ABOUT } from "./contract";
import { openGameTexts } from "./crypto";
import { gameMediaDelivery, isGameMediaStorageAvailable, readGameMedia } from "./media";
import { gameReportContentLabel, gameReportReasonLabel } from "./report-alert";
import { removeGamePostForReview, runGameCommand } from "./service";
import { getPrisma } from "../prisma";

/**
 * The ops side of game reports (/ops/game-reports): the open queue, with what
 * was reported as it was when reported, and the one review action. Ops
 * routes and pages check the operator before calling these.
 */

const QUEUE_LIMIT = 50;

export interface GameReportQueueItem {
  reportId: string;
  createdAt: string;
  reason: string;
  content: string;
  gameId: string | null;
  entryId: string | null;
  reporterMemberId: string;
  reportedMemberId: string | null;
  reportedSuspended: boolean;
  postRemoved: boolean;
  /** The reported words (or name, or terms) and the reporter's note, as sent. */
  snapshotText: string | null;
  note: string | null;
  /** Short-lived image links (or inline bytes locally) for the reported photos. */
  images: string[];
}

export async function readGameReportQueue(): Promise<GameReportQueueItem[]> {
  const prisma = getPrisma();
  const rows = await prisma.gameReport.findMany({
    include: { entry: { select: { kind: true, withdrawnReason: true } }, reported: { select: { member: { select: { suspendedAt: true } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: QUEUE_LIMIT,
    where: { reviewedAt: null },
  });
  const plain = await openGameTexts(rows.flatMap((row) => [
    { field: "snapshot", memberId: row.reporterMemberId, rowId: row.id, table: "game_report" as const, value: row.snapshotTextEncrypted },
    { field: "note", memberId: row.reporterMemberId, rowId: row.id, table: "game_report" as const, value: row.noteEncrypted },
  ]));
  return Promise.all(rows.map(async (row, index) => ({
    content: gameReportContentLabel({ about: GAME_REPORT_ABOUT.find((about) => about === row.about) ?? "post",
      entryKind: GAME_ENTRY_KINDS.find((kind) => kind === row.entry?.kind) ?? null, fromInvite: false }),
    createdAt: row.createdAt.toISOString(),
    entryId: row.entryId,
    gameId: row.gameId,
    images: await reviewImages(row.snapshotMediaKeys),
    note: plain[index * 2 + 1] ?? null,
    postRemoved: row.entry === null ? row.about === "post" : row.entry.withdrawnReason === "removed",
    reason: gameReportReasonLabel(row.reason),
    reportedMemberId: row.reportedMemberId,
    reportedSuspended: row.reported?.member.suspendedAt != null,
    reporterMemberId: row.reporterMemberId,
    reportId: row.id,
    snapshotText: plain[index * 2] ?? null,
  })));
}

async function reviewImages(keys: readonly string[]): Promise<string[]> {
  if (!isGameMediaStorageAvailable()) return [];
  const images = await Promise.all(keys.map(async (key) => {
    try {
      const delivery = await gameMediaDelivery(key, "photo");
      if (delivery) return delivery.url;
      const local = await readGameMedia(key);
      return local ? `data:${local.contentType};base64,${Buffer.from(local.bytes).toString("base64")}` : null;
    } catch {
      return null;
    }
  }));
  return images.flatMap((image) => (image ? [image] : []));
}

export interface GameReportReview {
  reportId: string;
  /** Take the reported post down for everyone. */
  removePost?: boolean;
  /** End every game between the two, as a block by the reporter does (they can unblock in Settings). */
  endGames?: boolean;
  /** Suspend the reported member's account. */
  suspendMember?: boolean;
}

/** Applies the chosen actions, then marks the report reviewed. Each action is safe to repeat. */
export async function reviewGameReport(review: GameReportReview): Promise<{ found: boolean }> {
  const prisma = getPrisma();
  const report = await prisma.gameReport.findUnique({ where: { id: review.reportId } });
  if (!report) return { found: false };
  if (review.removePost && report.entryId) await removeGamePostForReview(report.entryId);
  if (review.endGames && report.reportedMemberId) {
    const ended = await runGameCommand({ actorMemberId: report.reporterMemberId, command: { memberId: report.reportedMemberId, type: "block" } });
    // From an invite they never shared a game: there is nothing to end.
    if (!ended.ok && ended.error.code !== "NOT_A_PLAYER") throw new Error(`Ending the reported games failed: ${ended.error.code}.`);
  }
  if (review.suspendMember && report.reportedMemberId) {
    await prisma.hostedMember.updateMany({ data: { suspendedAt: new Date() }, where: { id: report.reportedMemberId, suspendedAt: null } });
  }
  await prisma.gameReport.updateMany({ data: { reviewedAt: new Date() }, where: { id: report.id, reviewedAt: null } });
  return { found: true };
}
