import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import type { Game, Prisma } from '@prisma/client';
import sharp from 'sharp';
import { gameRecapEnvelopeSchema, type GameRecapStory, type GameRecapDraft, type RecapAsset } from '@murphai/contracts/recap-show';
import { renderRecapPageSvg } from '@murphai/contracts/recap-renderer';
import { getPrisma } from '../prisma';
import { isPairRecapShowEnabled } from './access';
import { readGameRecapMaterial } from './service';
import { registerRecapAssetsTx, retainRecapAssetTx } from './recap-retirement';
import { putRecapMedia, readRecapMedia } from './recap-media';
import { recapReferencesCurrent } from './recap-asset-access';
import { readRecapAdmissionTx, recapDraftHash, recapGenerationId, recapMediaKey, recapSelectionKey, recapSelectionSchema } from './recap-submission';
import { readGameRecapEntryIdsTx } from './recap-witness';

/** Only selected, uploaded bytes reach the accepted envelope. No pending recipe
 * or separately scheduled generator exists after this boundary. */
export async function prepareRecapGeneration(input: {
  row: Game; story: GameRecapStory; eventId: string; playerMemberIds: readonly string[];
  files?: GameRecapDraft['files']; beforeMutationTx: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  if (!isPairRecapShowEnabled(input.row.maxPlayers) || (!input.story.treatment && input.files === undefined) || !input.row.chatContainerMemberId) return null;
  if (!input.files) throw new Error('Pair shows require a selected-file submission.');
  const db = getPrisma();
  const material = await readGameRecapMaterial(input.row.id, input.row.chatContainerMemberId, input.playerMemberIds, input.eventId);
  if (!material) throw new Error('Recap material is no longer available.');
  const frozen = await db.gameEvent.findUnique({ where: { commandKey: recapSelectionKey(input.eventId) }, select: { payload: true } });
  const selection = recapSelectionSchema.parse(frozen?.payload);
  if (selection.hash !== recapDraftHash({ story: input.story, files: input.files }) || Date.now() >= Date.parse(selection.deadline)) throw new Error('Frozen recap submission changed or expired.');
  const admission = await readRecapAdmissionTx(db, input.eventId);
  const generationId = recapGenerationId(input.eventId);
  const assets: RecapAsset[] = [];
  for (const { slot, receipt } of selection.files) {
    const operation = admission.operations.find(operation => operation.id === receipt.operationId);
    if (!operation?.receipt || operation.receipt.hash !== receipt.hash) throw new Error('Missing provider receipt.');
    const storageKey = recapMediaKey(input.eventId, receipt);
    const stored = await readRecapMedia({ storageKey, ownerMemberId: input.row.wordsOwnerMemberId });
    if (!stored || stored.hash !== receipt.hash) throw new Error('Selected media has not been uploaded.');
    assets.push({ slot, kind: operation.kind, recipeId: receipt.operationId, storageKey, references: operation.references,
      hash: receipt.hash, byteLength: receipt.byteLength, mediaType: receipt.mediaType, width: receipt.width, height: receipt.height, durationMs: receipt.durationMs });
  }
  const now = new Date();
  // A cover is always complete at acceptance. Failed image generation gets a
  // deterministic title card; capability previews never reveal a raw player photo.
  if (!assets.some(asset => asset.slot === 'scene-0') && input.story.pages[0]) {
    const first = input.story.pages[0];
    const rendered = renderRecapPageSvg({ page: { id: 'cover', kind: 'cover', background: first.background,
      blocks: first.blocks.flatMap(({ scene: _scene, ...block }) => block.kind === 'scene' ? [] : [{ ...block, kind: block.kind }]) },
      treatment: input.story.treatment ?? '', photos: new Map(), result: material.validation.result });
    const bytes = await sharp(Buffer.from(rendered.svg)).jpeg({ quality: 85 }).toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `recap/${generationId}/${hash}.jpg`;
    await db.$transaction(async tx => {
      await input.beforeMutationTx(tx);
      await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.row.id} FOR UPDATE`;
      const current = await tx.game.findUnique({ where: { id: input.row.id }, include: { players: { take: 3 } } });
      if (!current || current.wordsOwnerMemberId !== input.row.wordsOwnerMemberId || !await readGameRecapEntryIdsTx(tx, current, input.eventId)
        || !await recapReferencesCurrent(tx, current.id, [])) throw new Error('Recap authority changed.');
      await registerRecapAssetsTx(tx, { gameId: current.id, generationId, ownerMemberId: current.wordsOwnerMemberId,
        storageKeys: [storageKey], acceptedAt: now, recoveryUntil: new Date(selection.deadline) });
    });
    const meta = await putRecapMedia({ storageKey, ownerMemberId: input.row.wordsOwnerMemberId, bytes });
    assets.push({ slot: 'scene-0', kind: 'image', recipeId: 'fallback-cover', storageKey, references: [],
      hash: meta.hash, byteLength: meta.bytes, mediaType: meta.mediaType, width: meta.width, height: meta.height });
  }
  const envelope = gameRecapEnvelopeSchema.parse({ version: 1, generationId, story: input.story, assets,
    acceptedAt: now.toISOString(),
    preview: { token: randomBytes(32).toString('base64url'), expiresAt: new Date(now.getTime() + 30 * 86400_000).toISOString() } });
  return { envelope, async publish(tx: Prisma.TransactionClient) {
    const current = await tx.gameEvent.findUnique({ where: { commandKey: recapSelectionKey(input.eventId) }, select: { payload: true } });
    if (recapSelectionSchema.parse(current?.payload).hash !== selection.hash || Date.now() >= Date.parse(selection.deadline)
      || !await recapReferencesCurrent(tx, input.row.id, assets)) throw new Error('Recap submission authority changed.');
    for (const asset of assets) if (!await retainRecapAssetTx(tx, { gameId: input.row.id, generationId,
      ownerMemberId: input.row.wordsOwnerMemberId, storageKey: asset.storageKey, now: new Date() })) throw new Error('Selected recap media was retired.');
  } };
}
