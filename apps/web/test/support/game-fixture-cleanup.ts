import type { PrismaClient } from "@prisma/client";

/** `source_ref` names a game without a foreign key, so deleting a game alone orphans its receipts. */
export async function cleanupGameFixtures(prisma: PrismaClient, ownerMemberIds: string[]): Promise<void> {
  const games = await prisma.game.findMany({
    where: { wordsOwnerMemberId: { in: ownerMemberIds } },
    select: { id: true },
  });
  if (games.length === 0) return;
  await prisma.hostedLinqDelivery.deleteMany({
    where: {
      source: "game_lifecycle",
      OR: games.flatMap(game => [{ sourceRef: game.id }, { sourceRef: { startsWith: `${game.id}:` } }]),
    },
  });
  await prisma.game.deleteMany({ where: { id: { in: games.map(game => game.id) } } });
}
