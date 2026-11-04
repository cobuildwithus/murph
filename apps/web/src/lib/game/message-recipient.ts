import "server-only";

import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { getPrisma } from "../prisma";
import { isGameOn } from "./access";
import { isHiddenBy, readGameBlocks } from "./blocks";

/**
 * Who Message texts on a live pair game: the other player's verified number.
 * Both players shook on the game, and its Murph chat already puts their two
 * numbers in one iMessage room. The number is read only when the player taps
 * Message, never with Home, so it is opened only when someone means to text.
 *
 * `undefined` when the viewer can't see the game. `null` when there's no one
 * to text: a group, an invite or a finished game, a player who left or was
 * suspended, a block either way, or no verified number.
 */
export async function readGameMessageRecipient(gameId: string, viewerId: string): Promise<string | null | undefined> {
  const prisma = getPrisma();
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      maxPlayers: true,
      status: true,
      players: { select: { memberId: true, leftAt: true } },
      invitees: { select: { memberId: true } },
    },
  });
  if (!game || !isGameOn(game)) return undefined;
  const me = game.players.find(player => player.memberId === viewerId);
  if (!me || me.leftAt) return undefined;
  if (game.maxPlayers !== 2 || game.status !== "live" || game.players.length !== 2) return null;
  const otherId = game.players.find(player => player !== me && !player.leftAt)?.memberId;
  if (!otherId) return null;
  const [blocks, other] = await Promise.all([
    readGameBlocks(prisma, viewerId, [otherId]),
    prisma.hostedMember.findUnique({ where: { id: otherId }, select: { suspendedAt: true } }),
  ]);
  if (isHiddenBy(blocks, otherId) || !other || other.suspendedAt) return null;
  const identity = await readHostedMemberIdentity({ memberId: otherId, prisma });
  return identity?.phoneNumberVerifiedAt && identity.phoneNumber ? identity.phoneNumber : null;
}
