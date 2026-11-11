import { RecapControlError } from '@murphai/contracts/recap-admission';
import { RecapRejectionError, validateRecapFileSelection } from '@murphai/contracts/recap-validation';
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
export async function prepareRecapSubmission(input: Identity & { draft: GameRecapDraft; trustedFallback?: true; validateOnly?: boolean }) {
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
    } else if (Date.now() >= Date.parse(admission.deadline)) throw new RecapRejectionError([{ rule: 'submission_deadline', message: 'The generation deadline passed. Stop; the host owns terminal recovery.' }]);
    if (new Set(input.draft.files.map(file => file.receipt.operationId)).size !== input.draft.files.length) throw new RecapRejectionError([{ rule: 'media_operation_duplicate', message: 'Select each generated operation at most once. Keep its receipt in only one scene-N/song slot.' }]);
    await validateSelectedRecapFiles(tx, input, admission, material);
    if (input.validateOnly) return { validated: true, draftHash: hash };
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
    || metadata.width !== input.receipt.width || metadata.height !== input.receipt.height || metadata.durationMs !== input.receipt.durationMs) throw new RecapRejectionError([{ rule: 'media_integrity', message: 'Selected bytes do not match the receipt. Restore the original generated file and unchanged receipt.' }]);
  const audience = await readGameChatAudience(input.memberId);
  const ownerMemberId = await getPrisma().$transaction(async tx => {
    const { game } = await requireRecapAdmissionAuthorityTx(tx, input, audience);
    const row = await tx.gameEvent.findUnique({ where: { commandKey: recapSelectionKey(input.eventId) }, select: { payload: true } });
    const selection = recapSelectionSchema.parse(row?.payload);
    if (Date.now() >= Date.parse(selection.deadline) || !selection.files.some(file => JSON.stringify(file.receipt) === JSON.stringify(input.receipt))) throw new RecapRejectionError([{ rule: 'frozen_mismatch', message: 'Upload only the unchanged receipt selected in the frozen draft, before its deadline.' }]);
    const admission = await readRecapAdmissionTx(tx, input.eventId);
    const operation = admission.operations.find(operation => operation.id === input.receipt.operationId);
    if (!operation || !await recapReferencesCurrent(tx, input.gameId, [operation])) throw new RecapRejectionError([{ rule: 'reference_revoked', message: 'Selected references are no longer authorized. Stop this generation; do not reuse revoked photos.' }]);
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
  const errors = validateRecapFileSelection({ draft: input.draft, players: material.validation.playerNamesByMemberId, operations: admission.operations });
  if (errors.length) throw new RecapRejectionError(errors);
  const selected = admission.operations.filter(operation => input.draft.files.some(file => file.receipt.operationId === operation.id));
  if (!await recapReferencesCurrent(tx, input.gameId, selected)) throw new RecapRejectionError([{ rule: 'reference_revoked', message: 'Selected photo references are no longer authorized. Stop this generation.' }]);
}
