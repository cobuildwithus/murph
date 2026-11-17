import "server-only";

import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { getPrisma } from "../prisma";
import { isGameEnabled } from "./access";
import { isHiddenBy, readGameBlocks } from "./blocks";
import { gamePairWhere } from "./chat-membership";

/**
 * Who Message texts on a live pair game: the other player's verified number.
 * Both players shook on the game and both have verified numbers, the same
 * ones Murph uses to put the pair in their game chat, so it's an exchange:
 * a viewer without a verified number of their own gets none. The number is
 * read only when the player taps Message, never with Home, so it is opened
 * only when someone means to text.
 *
 * The challenger's invite to someone they've already played a game with
 * (addressed to that member) texts them the same way: the pair shook on a
 * game before, so it's the number Message gave them then.
 *
 * `undefined` when the viewer can't see the game. `null` when there's no one
 * to text: a group, an open invite or a finished game, a player who left or
 * was suspended, a block either way, or either player without a verified
 * number.
 */
export async function readGameMessageRecipient(gameId: string, viewerId: string): Promise<string | null | undefined> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      createdBy: true,
      maxPlayers: true,
      status: true,
      players: { select: { memberId: true, leftAt: true } },
      invitees: { select: { memberId: true } },
    },
  });
  if (!game || !isGameEnabled()) return undefined;
  const me = game.players.find(player => player.memberId === viewerId);
  if (!me || me.leftAt) return undefined;
  if (game.maxPlayers !== 2) return null;
  const otherId = game.status === "live" && game.players.length === 2
    ? game.players.find(player => player !== me && !player.leftAt)?.memberId
    : await addressedInvitee(game, viewerId);
  if (!otherId) return null;
  const [blocks, other, mine] = await Promise.all([
    readGameBlocks(prisma, viewerId, [otherId]),
    prisma.hostedMember.findUnique({ where: { id: otherId }, select: { suspendedAt: true } }),
    prisma.hostedMemberIdentity.findUnique({
      where: { memberId: viewerId },
      select: { phoneNumberEncrypted: true, phoneNumberVerifiedAt: true },
    }),
  ]);
  if (isHiddenBy(blocks, otherId) || !other || other.suspendedAt) return null;
  if (!mine?.phoneNumberVerifiedAt || !mine.phoneNumberEncrypted) return null;
  const identity = await readHostedMemberIdentity({ memberId: otherId, prisma });
  return identity?.phoneNumberVerifiedAt && identity.phoneNumber ? identity.phoneNumber : null;
}

/**
 * The member the viewer's own invite is addressed to, when the pair has shaken
 * on a one-on-one game before. A group never counts, even one of just the two
 * of them: a group never gives a number.
 */
async function addressedInvitee(
  game: { createdBy: string | null; status: string; players: unknown[]; invitees: { memberId: string | null }[] },
  viewerId: string,
): Promise<string | null> {
  if (game.status !== "invited" || game.createdBy !== viewerId || game.players.length !== 1) return null;
  const invitee = game.invitees.find(row => row.memberId !== null && row.memberId !== viewerId)?.memberId;
  if (!invitee) return null;
  const shook = await getPrisma().game.findFirst({
    where: { ...gamePairWhere([viewerId, invitee]), maxPlayers: 2, status: { in: ["live", "settled"] } },
    select: { id: true },
  });
  return shook ? invitee : null;
}
