import "server-only";
import type { Prisma } from "@prisma/client";
import { storedGameRecapEnvelopeSchema, type GameRecapEnvelope } from "@murphai/contracts/recap-show";
import { getPrisma } from "../prisma";
import { openGameTexts } from "./crypto";
import { isRecapMediaVisible } from "./access";
import { readGame } from "./service";
import { readRecapMedia } from "./recap-media";

/** Current roster, blocks, reports and exact source keys. Used at admission,
 * publication and delivery; uploader ownership never bypasses recap authority. */
export async function recapReferencesCurrent(db: Prisma.TransactionClient, gameId: string, assets: readonly Pick<GameRecapEnvelope["assets"][number], "references">[]): Promise<boolean> {
  const game = await db.game.findUnique({ where: { id: gameId }, select: { maxPlayers: true, status: true, players: { select: { memberId: true, leftAt: true }, take: 3 } } });
  if (!game || game.maxPlayers !== 2 || game.status !== "settled" || game.players.length !== 2 || game.players.some(player => !player.memberId || player.leftAt)) return false;
  const memberIds = game.players.flatMap(player => player.memberId ? [player.memberId] : []);
  if (await db.hostedConsentGrant.count({ where: { memberId: { in: memberIds }, scope: "launch.health-data", status: "revoked" } })) return false;
  const blocked = await db.gameBlock.findFirst({ where: { blockerMemberId: { in: memberIds }, blockedMemberId: { in: memberIds } }, select: { blockerMemberId: true } });
  if (blocked) return false;
  const references = assets.flatMap(asset => asset.references);
  const entryIds = references.flatMap(ref => ref.kind === "entry" && ref.entryId ? [ref.entryId] : []);
  const reports = await db.gameReport.count({ where: { OR: [{ about: "player", reportedMemberId: { in: memberIds }, reporterMemberId: { in: memberIds } }, { entryId: { in: entryIds } }] } });
  if (reports) return false;
  const [profiles, entries] = await Promise.all([
    db.gameProfile.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, photoKey: true } }),
    db.gameEntry.findMany({ where: { id: { in: entryIds }, gameId, memberId: { in: memberIds }, withdrawnAt: null, attempt: { gt: 0 } }, select: { id: true, memberId: true, mediaKeys: true } }),
  ]);
  return references.every(ref => ref.kind === "murph" ? ref.key === "murph-character-sheet-v1"
    : ref.kind === "profile" ? profiles.some(profile => profile.memberId === ref.memberId && profile.photoKey === ref.key)
    : entries.some(entry => entry.id === ref.entryId && entry.memberId === ref.memberId && entry.mediaKeys.includes(ref.key)));
}

export async function readRecapEnvelope(gameId: string) {
  const row = await getPrisma().game.findUnique({ where: { id: gameId }, select: { id: true, wordsOwnerMemberId: true, recapEncrypted: true, maxPlayers: true, chatContainerMemberId: true } });
  if (!row?.recapEncrypted || row.maxPlayers !== 2) return null;
  const [plain] = await openGameTexts([{ memberId: row.wordsOwnerMemberId, table: "game", rowId: row.id, field: "recap", value: row.recapEncrypted }]);
  const parsed = storedGameRecapEnvelopeSchema.safeParse(JSON.parse(plain ?? "null"));
  return parsed.success ? { row, envelope: parsed.data } : null;
}

export async function readAuthorizedRecapAsset(input: { gameId: string; generationId: string; slot: string; memberId: string }) {
  if (!isRecapMediaVisible() || !(await readGame(input.gameId, input.memberId, false))?.recap?.show) return null;
  const current = await readRecapEnvelope(input.gameId);
  if (!current || current.envelope.generationId !== input.generationId) return null;
  const asset = current.envelope.assets.find(item => item.slot === input.slot);
  if (!asset || !await recapReferencesCurrent(getPrisma(), input.gameId, [asset])) return null;
  const stored = await readRecapMedia({ storageKey: asset.storageKey, ownerMemberId: current.row.wordsOwnerMemberId });
  if (!stored || stored.hash !== asset.hash) return null;
  return { bytes: stored.bytes, contentType: asset.mediaType! };
}
