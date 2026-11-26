import { randomUUID } from "node:crypto";
import { toPrismaJsonObject } from "@/src/lib/device-sync/prisma-store/prisma-json";
import { sealGameText } from "@/src/lib/game/crypto";
import { decideNewTerms, type StoredResult } from "@/src/lib/game/rules";
import { getPrisma } from "@/src/lib/prisma";

export async function seedHealthPayoff({
  winnerId, debtorId, settledAt = new Date(), kind = "dare",
}: { winnerId: string; debtorId: string; settledAt?: Date; kind?: "dare" | "prize" }) {
  const db = getPrisma();
  const gameId = randomUUID(), ticketId = randomUUID(), stakeKey = randomUUID();
  const dayOne = new Date(settledAt);
  dayOne.setUTCDate(dayOne.getUTCDate() - 6);
  dayOne.setUTCHours(0, 0, 0, 0);
  for (const [memberId, name] of [[winnerId, "Vela"], [debtorId, "Miro"]] as const) {
    const firstNameEncrypted = await sealGameText({ table: "game_profile", field: "first_name", rowId: memberId, memberId }, name);
    if (!firstNameEncrypted) throw new Error("Expected a sealed profile name.");
    await db.gameProfile.createMany({ data: [{ memberId, firstNameEncrypted, timeZone: "UTC" }], skipDuplicates: true });
  }
  const { terms, words, lengthDays } = decideNewTerms({
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
    tasks: [0, 1].map(seat => ({ seat, text: "Relay warmups" })),
    stakes: [{ kind, item: "Sketch a trail map" }],
  }, { newKey: () => stakeKey, today: dayOne.toISOString().slice(0, 10) });
  const termsWordsEncrypted = await sealGameText(
    { table: "game", field: "terms_words", rowId: gameId, memberId: winnerId }, JSON.stringify(words),
  );
  if (!termsWordsEncrypted) throw new Error("Expected sealed game terms.");
  const result: StoredResult = { v: 1, termsVersion: 1, scores: [
    { seat: 0, memberId: winnerId, score: 5, misses: 2 },
    { seat: 1, memberId: debtorId, score: 3, misses: 4 },
  ] };
  await db.game.create({ data: {
    id: gameId, createdBy: winnerId, wordsOwnerMemberId: winnerId,
    terms: toPrismaJsonObject(terms), termsWordsEncrypted, status: "settled",
    startedAt: dayOne, startsOn: dayOne, lengthDays, settledAt, result: toPrismaJsonObject(result),
    players: { create: [winnerId, debtorId].map((memberId, seat) => ({ memberId, seat, joinedAt: dayOne, dayOne, timeZone: "UTC" })) },
    tickets: { create: { id: ticketId, stakeKey, owedBySeats: [1], owedToSeats: [0] } },
  } });
  return { gameId, ticketId, stakeKey, result, terms };
}
