import "server-only";

import type { Prisma } from "@prisma/client";

/**
 * Blocks between game players. A block hides two people from each other:
 * each sees the other as a player who left (see `views.ts`), and the blocker's
 * Home leaves them out. Reads are bounded by the people already in view.
 */

type Db = Pick<Prisma.TransactionClient, "gameBlock">;

/** At most this many people blocked by one member; Settings lists them all. */
export const GAME_BLOCK_LIMIT = 500;

export interface GameBlocks {
  /** People the viewer blocked: left off the viewer's Home. */
  blocked: ReadonlySet<string>;
  /** People who blocked the viewer. */
  blockedBy: ReadonlySet<string>;
}

export const NO_GAME_BLOCKS: GameBlocks = { blocked: new Set(), blockedBy: new Set() };

/** Blocked either way: they see each other as having left. */
export function isHiddenBy(blocks: GameBlocks, memberId: string | null): boolean {
  return memberId !== null && (blocks.blocked.has(memberId) || blocks.blockedBy.has(memberId));
}

/** The blocks between the viewer and these people, both ways. */
export async function readGameBlocks(db: Db, viewerId: string, others: Iterable<string>): Promise<GameBlocks> {
  const ids = [...new Set(others)].filter((id) => id !== viewerId);
  if (ids.length === 0) return NO_GAME_BLOCKS;
  const rows = await db.gameBlock.findMany({
    select: { blockedMemberId: true, blockerMemberId: true },
    where: { OR: [
      { blockerMemberId: viewerId, blockedMemberId: { in: ids } },
      { blockedMemberId: viewerId, blockerMemberId: { in: ids } },
    ] },
  });
  return {
    blocked: new Set(rows.filter((row) => row.blockerMemberId === viewerId).map((row) => row.blockedMemberId)),
    blockedBy: new Set(rows.filter((row) => row.blockedMemberId === viewerId).map((row) => row.blockerMemberId)),
  };
}

export async function areGamePlayersBlocked(db: Db, a: string, b: string): Promise<boolean> {
  return isHiddenBy(await readGameBlocks(db, a, [b]), b);
}

/**
 * Serializes a block with anything that could start a game between the same
 * two people (joining, negotiating). Taken before any game row lock.
 */
export async function lockGamePair(tx: Pick<Prisma.TransactionClient, "$executeRaw">, a: string, b: string): Promise<void> {
  const pair = [a, b].sort().join(":");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('weekly-game-pair'), hashtext(${pair}))`;
}
