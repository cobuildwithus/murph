import { RecapControlError } from '@murphai/contracts/recap-admission';
import { readGameRecapMaterial } from './service';
import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import * as z from '@murphai/contracts/zod-runtime';
import { gameRecapDraftSchema, type GameRecapDraft, type RecapFileReceipt } from '@murphai/contracts/recap-show';
import { getPrisma } from '../prisma';
import type { HostedRuntimeIdentity } from '../hosted-execution/runtime-owner';
import { readGameChatAudience } from './chat-membership';
import { requireRecapAdmissionAuthorityTx, storedRecapAdmissionSchema } from './recap-admission';
import { registerRecapAssetsTx } from './recap-retirement';
import { inspectRecapMedia, putRecapMedia } from './recap-media';
import { recapReferencesCurrent } from './recap-asset-access';

type Identity = { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; gameId: string; eventId: string };
export const recapSelectionSchema = z.object({ v: z.literal(1), hash: z.string().regex(/^[a-f0-9]{64}$/u), deadline: z.string(),
  files: gameRecapDraftSchema.shape.files }).strict();
export const recapGenerationId = (eventId: string) => createHash('sha256').update(`recap-generation:${eventId}`).digest('hex').slice(0, 32);
export const recapSelectionKey = (eventId: string) => `${eventId}:selection`;
export const recapMediaKey = (eventId: string, receipt: RecapFileReceipt) => `recap/${recapGenerationId(eventId)}/${receipt.hash}.${receipt.mediaType === 'image/jpeg' ? 'jpg' : 'mp3'}`;
export const recapDraftHash = (draft: GameRecapDraft) => createHash('sha256').update(JSON.stringify(gameRecapDraftSchema.parse(draft))).digest('hex');

/** Validation happens first. Freeze precisely what this submission may upload. */
export async function prepareRecapSubmission(input: Identity & { draft: GameRecapDraft; trustedFallback?: true }) {
  const audience = await readGameChatAudience(input.memberId);
  const material = await readGameRecapMaterial(input.gameId, input.memberId, audience.memberIds, input.eventId, audience);
  if (!material) throw new Error('Recap material is unavailable.');
  return getPrisma().$transaction(async tx => {
    await requireRecapAdmissionAuthorityTx(tx, input, audience);
    const hash = recapDraftHash(input.draft);
    const prior = await tx.gameEvent.findUnique({ where: { commandKey: recapSelectionKey(input.eventId) }, select: { payload: true } });
    if (prior && !input.trustedFallback) {
      if (recapSelectionSchema.parse(prior.payload).hash !== hash) throw new RecapControlError('recap_submission_frozen');
      return { prepared: true, draftHash: hash };
    }
    const admission = await readRecapAdmissionTx(tx, input.eventId);
    if (input.trustedFallback) {
      if (admission.runs.length < 2 && Date.now() < Date.parse(admission.deadline)) throw new Error('Recap attempts remain.');
      if (input.draft.files.length) throw new Error('Fallback cannot select provider media.');
    } else if (Date.now() >= Date.parse(admission.deadline)) throw new Error('Recap submission deadline reached.');
    if (new Set(input.draft.files.map(file => file.receipt.operationId)).size !== input.draft.files.length) throw new Error('Select each generated operation at most once.');
    await validateSelectedRecapFiles(tx, input, admission, material);
    const payload = { v: 1, hash, deadline: input.trustedFallback ? new Date(Date.now() + 30_000).toISOString() : admission.deadline, files: input.draft.files };
    await tx.gameEvent.upsert({ where: { commandKey: recapSelectionKey(input.eventId) },
      create: { gameId: input.gameId, actor: 'system', type: 'recap_selection', commandKey: recapSelectionKey(input.eventId), payload }, update: { payload } });
    return { prepared: true, draftHash: hash };
  });
}

/** Register before upload, so a crash at any later step leaves a cleanup owner. */
export async function stageRecapSubmissionFile(input: Identity & { receipt: RecapFileReceipt; bytes: string }) {
  const bytes = Buffer.from(input.bytes, 'base64');
  const storageKey = recapMediaKey(input.eventId, input.receipt);
  const metadata = await inspectRecapMedia(bytes, storageKey, input.receipt.mediaType === 'audio/mpeg' ? 20_000 : undefined);
  if (metadata.hash !== input.receipt.hash || metadata.bytes !== input.receipt.byteLength
    || metadata.width !== input.receipt.width || metadata.height !== input.receipt.height || metadata.durationMs !== input.receipt.durationMs) throw new Error('Selected file integrity failed.');
  const audience = await readGameChatAudience(input.memberId);
  const ownerMemberId = await getPrisma().$transaction(async tx => {
    const { game } = await requireRecapAdmissionAuthorityTx(tx, input, audience);
    const row = await tx.gameEvent.findUnique({ where: { commandKey: recapSelectionKey(input.eventId) }, select: { payload: true } });
    const selection = recapSelectionSchema.parse(row?.payload);
    if (Date.now() >= Date.parse(selection.deadline) || !selection.files.some(file => JSON.stringify(file.receipt) === JSON.stringify(input.receipt))) throw new Error('File is not in the frozen recap submission.');
    const admission = await readRecapAdmissionTx(tx, input.eventId);
    const operation = admission.operations.find(operation => operation.id === input.receipt.operationId);
    if (!operation || !await recapReferencesCurrent(tx, input.gameId, [operation])) throw new Error('Selected media references were revoked.');
    await registerRecapAssetsTx(tx, { gameId: input.gameId, generationId: recapGenerationId(input.eventId), ownerMemberId: game.wordsOwnerMemberId,
      storageKeys: [storageKey], acceptedAt: new Date(), recoveryUntil: new Date(selection.deadline) });
    return game.wordsOwnerMemberId;
  });
  await putRecapMedia({ storageKey, ownerMemberId, bytes, durationMs: input.receipt.mediaType === 'audio/mpeg' ? 20_000 : undefined });
  return { staged: true, hash: metadata.hash };
}

export async function readRecapAdmissionTx(tx: Prisma.TransactionClient, eventId: string) {
  const row = await tx.gameEvent.findUnique({ where: { commandKey: `${eventId}:admission` }, select: { payload: true } });
  return storedRecapAdmissionSchema.parse(row?.payload);
}

async function validateSelectedRecapFiles(tx: Prisma.TransactionClient, input: Identity & { draft: GameRecapDraft },
  admission: Awaited<ReturnType<typeof readRecapAdmissionTx>>, material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>) {
    for (const file of input.draft.files) {
      const operation = admission.operations.find(operation => operation.id === file.receipt.operationId);
      if (!operation?.receipt || !operation.consumed || operation.active
        || JSON.stringify(operation.receipt) !== JSON.stringify(file.receipt)
        || !await recapReferencesCurrent(tx, input.gameId, [operation])) throw new Error('Selected media lacks a current verified provider receipt.');
      if (file.slot === 'song' ? !input.draft.story.song || operation.kind !== 'song'
        : operation.kind !== 'image' || !input.draft.story.pages[Number(file.slot.slice(6))]?.blocks.some(block => block.kind === 'scene')) throw new Error('Selected media does not match its story slot.');
      if (file.slot !== 'song') {
        const scene = input.draft.story.pages[Number(file.slot.slice(6))]?.blocks.find(block => block.kind === 'scene')?.scene;
        if (!scene || scene.cast.some(name => {
          const player = material.validation.playerNamesByMemberId.find(player => player.name === name);
          return !player || !operation.references.some(reference => reference.kind !== 'murph' && reference.memberId === player.memberId);
        }) || scene.murph && !operation.references.some(reference => reference.kind === 'murph')) throw new Error('Scene cast lacks permitted identity references.');
      }

    }
}
