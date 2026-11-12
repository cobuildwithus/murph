import type { Prisma } from '@prisma/client';
import type { HostedGameToolRequest } from '@murphai/hosted-execution/runtime-control';
import { recapAssetSchema } from '@murphai/contracts/recap-show';
import { getPrisma } from '../prisma';
import { readGameChatAudience, readGameChatAuthority } from './chat-membership';
import { readGameRecapEntryIdsTx, readLatestGameRecapEventIdTx } from './recap-witness';
import { readRecapSourceReferences } from './recap-inputs';
import { recapReferencesCurrent } from './recap-asset-access';
import { registerRecapAssetsTx } from './recap-retirement';
import type { readGameRecapMaterial } from './service';
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { inspectGeneratedMp3Audio } from "@murphai/operator-config/generated-audio";
import { hostedRecapMediaObjectKey, requireHostedRecapMediaId } from "@murphai/hosted-execution/storage-paths";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { openGameMedia, sealGameMedia } from "./crypto";

export type RecapMediaMetadata = { hash: string; bytes: number; mediaType: "image/jpeg" | "audio/mpeg"; width?: number; height?: number; durationMs?: number };
type Identity = { storageKey: string; ownerMemberId: string };

/** Inspect and seal outside transactions. Upload retry reuses an immutable key;
 * a different ciphertext nonce is fine only when its plaintext hash is identical. */
export async function putRecapMedia(input: Identity & { bytes: Uint8Array; durationMs?: number }): Promise<RecapMediaMetadata> {
  requireHostedRecapMediaId(input.storageKey);
  const metadata = await inspectRecapMedia(input.bytes, input.storageKey, input.durationMs);
  const envelope = await sealGameMedia({ bytes: input.bytes, key: input.storageKey, ownerMemberId: input.ownerMemberId });
  const control = hostedControl();
  if (control) await control.putRecapMedia({ envelope, hash: metadata.hash, mediaId: input.storageKey, userId: input.ownerMemberId });
  else {
    const file = localFile(input);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    // A complete temporary file is atomically linked into the create-only slot.
    await writeFile(temporary, JSON.stringify({ envelope, hash: metadata.hash }), { flag: "wx" });
    const { link, unlink } = await import("node:fs/promises");
    try { await link(temporary, file); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    finally { await unlink(temporary); }
    const stored: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isStored(stored) || stored.hash !== metadata.hash) throw new Error("Recap asset is retired or has different bytes.");
  }
  return metadata;
}

export async function readRecapMedia(input: Identity): Promise<{ bytes: Uint8Array; hash: string } | null> {
  requireHostedRecapMediaId(input.storageKey);
  const control = hostedControl();
  let stored: unknown;
  if (control) stored = await control.readRecapMedia({ mediaId: input.storageKey, userId: input.ownerMemberId });
  else {
    try { stored = JSON.parse(await readFile(localFile(input), "utf8")); }
    catch (error) { if (hasCode(error, "ENOENT")) return null; throw error; }
  }
  if (!isStored(stored)) return null;
  const bytes = await openGameMedia({ envelope: stored.envelope, key: input.storageKey, ownerMemberId: input.ownerMemberId });
  if (createHash("sha256").update(bytes).digest("hex") !== stored.hash) throw new Error("Recap asset integrity failed.");
  return { bytes, hash: stored.hash };
}

/** The hosted sweeper uses the same permanent tombstone through its purge route. */
export async function retireRecapMedia(input: Identity): Promise<void> {
  const control = hostedControl();
  if (control) {
    await control.purgeRuntimeResource({ userId: input.ownerMemberId, resource: { kind: "game_recap", objectKey: hostedRecapMediaObjectKey({ userId: input.ownerMemberId, mediaId: input.storageKey }) } });
    return;
  }
  const file = localFile(input);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ retired: true }), { flag: "wx" });
  await rename(temporary, file);
}

export async function inspectRecapMedia(bytes: Uint8Array, storageKey: string, durationMs?: number): Promise<RecapMediaMetadata> {
  requireHostedRecapMediaId(storageKey);
  const image = storageKey.endsWith(".jpg");
  if (!bytes.length || bytes.length > (image ? 2 : 1) * 1024 * 1024) throw new RangeError("Recap asset size is invalid.");
  const metadata = { hash: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
  if (image) {
    const decoded = sharp(bytes, { limitInputPixels: 4_194_304, failOn: "warning" });
    const info = await decoded.metadata();
    if (info.format !== "jpeg" || !info.width || !info.height || info.width > 2048 || info.height > 2048) throw new TypeError("Recap image must be a bounded JPEG.");
    await decoded.raw().toBuffer();
    return { ...metadata, mediaType: "image/jpeg", width: info.width, height: info.height };
  }
  const mp3 = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 || bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  if (!mp3 || durationMs !== 20_000) throw new TypeError("Recap song must be a twenty-second MP3.");
  const decoded = await inspectGeneratedMp3Audio(bytes);
  if (Math.abs(decoded.durationMs - 20_000) > 500) throw new TypeError("Recap song duration is outside its twenty-second recipe.");
  return { ...metadata, mediaType: "audio/mpeg", durationMs: decoded.durationMs };
}

function hostedControl() {
  if (process.env.VERCEL_ENV !== "production" && process.env.VERCEL_ENV !== "preview") return null;
  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) throw new Error("Recap storage is unavailable.");
  return control;
}
function localFile(input: Identity): string {
  const root = path.resolve(process.env.MURPH_GAME_RECAP_MEDIA_DIR || ".tmp/recap-media");
  return path.join(root, hostedRecapMediaObjectKey({ userId: input.ownerMemberId, mediaId: input.storageKey }));
}
function hasCode(value: unknown, code: string): boolean { return typeof value === "object" && value !== null && "code" in value && value.code === code; }
function isStored(value: unknown): value is { envelope: string; hash: string } {
  return typeof value === "object" && value !== null && "envelope" in value && typeof value.envelope === "string" && "hash" in value && typeof value.hash === "string";
}

export const recapGenerationId = (eventId: string) => createHash('sha256').update(`recap-generation:${eventId}`).digest('hex').slice(0, 32);

/** The host supplies actual file bytes and its private source association. */
export async function uploadRecapMedia(input: {
  gameId: string; eventId: string; memberId: string;
  material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>;
  beforeMutationTx: (tx: Prisma.TransactionClient) => Promise<void>;
  file: Extract<NonNullable<Extract<HostedGameToolRequest, { action: 'read_game' }>['recapRead']>, { kind: 'upload' }>;
}) {
  const bytes = Buffer.from(input.file.bytes, 'base64');
  const generationId = recapGenerationId(input.eventId);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const storageKey = `recap/${generationId}/${hash}.${input.file.mediaType === 'image/jpeg' ? 'jpg' : 'mp3'}`;
  const available = await readRecapSourceReferences(input.material, input.eventId);
  const references = input.file.referenceIds.map(id => {
    const reference = available.find(value => value.id === id);
    if (!reference) throw new Error('A selected photo is no longer available.');
    const { id: _id, ...source } = reference;
    return source;
  });
  const audience = await readGameChatAudience(input.memberId);
  const now = new Date();
  const ownerMemberId = await getPrisma().$transaction(async tx => {
    await input.beforeMutationTx(tx);
    await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
    const game = await tx.game.findUnique({ where: { id: input.gameId }, include: { players: { take: 3 }, invitees: true } });
    if (!game || game.status !== 'settled' || game.maxPlayers !== 2
      || !await readGameChatAuthority(game, input.memberId, audience, tx)
      || await readLatestGameRecapEventIdTx(tx, game.id) !== input.eventId
      || !await readGameRecapEntryIdsTx(tx, game, input.eventId)
      || !await recapReferencesCurrent(tx, game.id, [{ references }])) throw new Error('Recap media is no longer authorized.');
    await registerRecapAssetsTx(tx, { gameId: game.id, generationId, ownerMemberId: game.wordsOwnerMemberId,
      storageKeys: [storageKey], acceptedAt: now, recoveryUntil: new Date(now.getTime() + 86400_000) });
    return game.wordsOwnerMemberId;
  });
  const metadata = await putRecapMedia({ storageKey, ownerMemberId, bytes,
    ...(input.file.mediaType === 'audio/mpeg' ? { durationMs: 20_000 } : {}) });
  const { bytes: byteLength, ...media } = metadata;
  return recapAssetSchema.parse({ slot: input.file.slot, kind: input.file.mediaType === 'image/jpeg' ? 'image' : 'song',
    recipeId: hash, storageKey, references, byteLength, ...media,
    ...(input.file.wordsTimestamps ? { wordsTimestamps: input.file.wordsTimestamps } : {}) });
}
