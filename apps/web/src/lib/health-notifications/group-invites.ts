import type { Prisma } from "@prisma/client";
import { areGameGroupsEnabled } from "../game/access";
import { addressedGameInvite } from "../game/audience";
import { toRuleState } from "../game/row";
import { hasPlayableGroupDay, isGameDue, lastCheckInDay } from "../game/rules";

/** An addressed seat can still be joined after a group starts. Use the invite preview's final-day rules. */
export async function playableGroupIds(db: Prisma.TransactionClient, member: string, keys: string[], zone: string, from: Date, now: Date) {
  if (!areGameGroupsEnabled()) return [];
  const games = await db.game.findMany({ where: { status: "live", maxPlayers: 10, createdAt: { gte: from, lte: now },
    invitees: { some: { OR: [{ memberId: member }, { memberId: null, recipientLookupKey: { in: keys } }] } },
    players: { none: { memberId: member } }, events: { none: { actor: member, type: "invite_dismissed" } } },
    include: { players: true, invitees: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 99 });
  const open = games.filter(game => {
    const seat = addressedGameInvite(game.invitees, member, keys)?.seat;
    return seat !== undefined && game.players.length < 10 && !game.players.some(p => p.seat === seat);
  });
  if (!open.length) return [];
  const entries = await db.gameEntry.findMany({
    where: { OR: open.map(g => ({ gameId: g.id, dayIndex: lastCheckInDay(toRuleState(g, [])) })) },
    select: { gameId: true, attempt: true, dayIndex: true, id: true, kind: true, mediaKeys: true,
      memberId: true, withdrawnAt: true, receivedAt: true, blurHash: true, incomplete: true },
  });
  const byGame = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = byGame.get(entry.gameId) ?? [];
    group.push(entry);
    byGame.set(entry.gameId, group);
  }
  return open.flatMap(g => {
    const state = toRuleState(g, byGame.get(g.id) ?? []);
    const clock = new Date(now.getTime() + Number(g.devClockOffsetMs ?? 0));
    return !isGameDue(state, clock) && hasPlayableGroupDay(state, zone, clock) ? [g.id] : [];
  });
}
