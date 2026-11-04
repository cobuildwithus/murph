import type { GameReply, Prisma } from "@prisma/client";
import type { GameErrorCode, GameReplyView } from "./contract";
import { isGameDue, type RuleState } from "./rules";

export interface ReplyContext {
  state: RuleState;
  visibleEntryIds: ReadonlySet<string>;
  /** Relative to the viewer; blocks and reports in either direction. */
  hiddenMemberIds: ReadonlySet<string>;
  reportedMemberIds: ReadonlySet<string>;
}

type ReplyIdentity = Pick<GameReply, "entryId" | "authorMemberId">;
export type ReplyMetadata = Omit<GameReply, "audioEncrypted">;

/** App reads, playback, report admission and push delivery share this authority. */
export function replyReadAccess(viewer: string, reply: ReplyIdentity, context: ReplyContext): boolean {
  const { state } = context;
  const entry = state.entries.find(entry => entry.id === reply.entryId);
  if (state.game.seats !== 2 || state.players.length !== 2 || !entry || entry.withdrawnAt || entry.kind === "excuse") return false;
  if (entry.memberId === reply.authorMemberId || ![entry.memberId, reply.authorMemberId].includes(viewer)) return false;
  if (![entry.memberId, reply.authorMemberId].every(id => state.players.some(player => player.memberId === id && !player.leftAt))) return false;
  const other = viewer === reply.authorMemberId ? entry.memberId : reply.authorMemberId;
  return context.visibleEntryIds.has(entry.id) && !context.hiddenMemberIds.has(other) && !context.reportedMemberIds.has(other);
}

/** Null means eligible. The same result drives the command and the app affordance. */
export function replyEligibility(viewer: string, entryId: string, context: ReplyContext, now: Date, occupied: boolean): GameErrorCode | null {
  if (!replyReadAccess(viewer, { entryId, authorMemberId: viewer }, context)) return "NOT_A_PLAYER";
  if (context.state.game.status !== "live" || isGameDue(context.state, now)) return "GAME_NOT_LIVE";
  return occupied ? "REPLY_USED" : null;
}

export function replyView(reply: ReplyMetadata, viewer: string, text: string | null): GameReplyView {
  const common = { id: reply.id, createdAt: reply.createdAt.toISOString(), mine: reply.authorMemberId === viewer };
  if (reply.kind === "text" && text !== null) return { ...common, kind: "text", text };
  if (reply.kind === "voice" && reply.durationMs !== null) return { ...common, kind: "voice", durationMs: reply.durationMs, levels: reply.levels };
  throw new Error("Stored game reply is malformed.");
}

export const replyMetadataSelect = {
  id: true, entryId: true, authorMemberId: true, kind: true, textEncrypted: true,
  durationMs: true, levels: true, createdAt: true,
} as const satisfies Prisma.GameReplySelect;

/** Tombstoning a post doesn't fire its FK cascade. Call inside the same game lock. */
export async function deleteEntryReplyTx(tx: Prisma.TransactionClient, entryId: string): Promise<void> {
  await tx.gameReply.deleteMany({ where: { entryId } });
}

/** Metadata only, across all games, in both directions. Bounded by the requested peers. */
export async function readReplyReportedMembers(db: Pick<Prisma.TransactionClient, "gameReport">, viewer: string, peers: string[]): Promise<Set<string>> {
  if (!peers.length) return new Set();
  const rows = await db.gameReport.groupBy({
    where: { OR: [{ reporterMemberId: viewer, reportedMemberId: { in: peers } }, { reportedMemberId: viewer, reporterMemberId: { in: peers } }] },
    by: ["reporterMemberId", "reportedMemberId"],
  });
  return new Set(rows.flatMap(row => (row.reporterMemberId === viewer ? row.reportedMemberId : row.reporterMemberId) ?? []));
}

export function replyReceiptMatches(receipt: { actor: string; gameId: string; payload: unknown }, actor: string, gameId: string, entryId: string): boolean {
  return receipt.actor === actor && receipt.gameId === gameId && typeof receipt.payload === "object" && receipt.payload !== null
    && "entryId" in receipt.payload && receipt.payload.entryId === entryId;
}
