import "server-only";
import type { Prisma } from "@prisma/client";
import { recapStorageObjects, storedGameRecapSchema, type GameRecapEnvelope } from "@murphai/contracts/recap-show";
import { getPrisma } from "../prisma";
import { openGameTexts } from "./crypto";
import { isRecapMediaVisible } from "./access";
import { readGame } from "./service";
import { readRecapMedia } from "./recap-media";
import { pairGamesWhere } from "./recap-inputs";
import { inspectMp3Frames } from "@murphai/operator-config/generated-audio";
import { parseGameRecapEventId } from "@murphai/hosted-execution/runtime-control";

/** Current roster, blocks, reports and exact source keys; a photo may come from
 * any of the pair's settled games. Used at admission, publication and delivery;
 * uploader ownership never bypasses recap authority. */
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
  const [profiles, contacts, entries] = await Promise.all([
    db.gameProfile.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, photoKey: true } }),
    references.some(ref => ref.kind === "contact") ? db.gameContactLabel.findMany({ where: { OR: [
      { ownerMemberId: memberIds[0], subjectMemberId: memberIds[1] },
      { ownerMemberId: memberIds[1], subjectMemberId: memberIds[0] },
    ], photoKey: { not: null } }, select: { subjectMemberId: true, photoKey: true } }) : [],
    db.gameEntry.findMany({ where: { id: { in: entryIds }, player: { game: pairGamesWhere(memberIds) }, memberId: { in: memberIds }, withdrawnAt: null, attempt: { gt: 0 } }, select: { id: true, memberId: true, mediaKeys: true } }),
  ]);
  return references.every(ref => ref.kind === "murph" ? ref.key === "murph-character-sheet-v1"
    : ref.kind === "profile" ? profiles.some(profile => profile.memberId === ref.memberId && profile.photoKey === ref.key)
    : ref.kind === "contact" ? contacts.some(contact => contact.subjectMemberId === ref.memberId && contact.photoKey === ref.key)
    : entries.some(entry => entry.id === ref.entryId && entry.memberId === ref.memberId && entry.mediaKeys.includes(ref.key)));
}

export async function readRecapEnvelope(gameId: string) {
  const row = await getPrisma().game.findUnique({ where: { id: gameId }, select: { id: true, wordsOwnerMemberId: true, recapEncrypted: true, maxPlayers: true, chatContainerMemberId: true } });
  if (!row?.recapEncrypted || row.maxPlayers !== 2) return null;
  const [plain] = await openGameTexts([{ memberId: row.wordsOwnerMemberId, table: "game", rowId: row.id, field: "recap", value: row.recapEncrypted }]);
  // A failed generation stores a bare fallback story on purpose; only an
  // envelope carries media. Anything matching neither shape is corrupt.
  const stored = storedGameRecapSchema.parse(JSON.parse(plain ?? "null"));
  return "version" in stored ? { row, envelope: stored } : null;
}

/** The stored recap, only while media may be shown and only as the generation the caller names. */
async function readVisibleRecapGeneration(gameId: string, generationId: string) {
  if (!isRecapMediaVisible()) return null;
  const current = await readRecapEnvelope(gameId);
  return current && current.envelope.generationId === generationId ? current : null;
}

/** One stored object by slot: a scene, the song (or its whole score) or a part of the video, each under its own sources. */
export async function readAuthorizedRecapAsset(input: { gameId: string; generationId: string; slot: string; memberId: string }) {
  if (!isRecapMediaVisible() || !(await readGame(input.gameId, input.memberId, false))?.recap?.show) return null;
  const current = await readVisibleRecapGeneration(input.gameId, input.generationId);
  // The score and the song are one stored file: the score is all of it, the song starts where the singing does.
  const slot = input.slot === "score" ? "song" : input.slot;
  const object = current && recapStorageObjects(current.envelope).find(item => item.slot === slot);
  if (!current || !object || !await recapReferencesCurrent(getPrisma(), input.gameId, [object])) return null;
  const songStartMs = current.envelope.assets.find(asset => asset.slot === slot)?.songStartMs;
  if (input.slot === "score" && songStartMs === undefined) return null;
  const stored = await readRecapMedia({ storageKey: object.storageKey, ownerMemberId: current.row.wordsOwnerMemberId });
  if (!stored) return null;
  if (stored.hash !== object.hash) throw new Error("Stored recap asset integrity mismatch.");
  if (input.slot === "song" && songStartMs !== undefined) {
    const cut = inspectMp3Frames(stored.bytes).frames.find(frame => frame.timeMs === songStartMs);
    if (!cut) throw new Error("Stored recap song frame is missing.");
    return { bytes: stored.bytes.subarray(cut.byteOffset), contentType: object.mediaType };
  }
  // A part is a slice of a file, not a playable one.
  return { bytes: stored.bytes, contentType: object.mediaType === "video/mp4" ? "application/octet-stream" : object.mediaType };
}

/** Whether the video Web accepted may be shown or sent now: media is visible, this
 * generation and file are still the recap's, and every source it shows is still
 * permitted. Serving a part and sending the file in chat ask the same question. */
export async function isRecapVideoCurrent(input: { gameId: string; generationId: string; hash: string }): Promise<boolean> {
  const video = (await readVisibleRecapGeneration(input.gameId, input.generationId))?.envelope.video;
  return video?.hash === input.hash && await recapReferencesCurrent(getPrisma(), input.gameId, [video]);
}

/** The runtime's question before it uploads a recap message's video and before each send that carries it:
 * may this accepted video still go to the recap's chat? Null when the request is not about one. The game is
 * the delivery key's own, so a runtime can only ask about the recap it is sending. */
export async function readRecapVideoDeliveryCurrent(idempotencyKey: string | null, value: unknown): Promise<boolean | null> {
  if (value === undefined || value === null) return null;
  const recap = idempotencyKey ? parseGameRecapEventId(idempotencyKey) : null;
  const identity = typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const { generationId, hash } = identity;
  if (!recap || typeof generationId !== "string" || !/^[a-f0-9]{32}$/u.test(generationId)
    || typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) return false;
  return isRecapVideoCurrent({ gameId: recap.gameId, generationId, hash });
}
