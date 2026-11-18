import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { after } from 'next/server';
import type { GameProgressShare, Prisma } from '@prisma/client';
import type { ClientUnits } from '../../companion/client-info';
import { assertBrowserVaultMemberAuthority } from '../../browser-vault/authority';
import { readSavedCompanionBodyHeight } from '../../device-sync/companion-numbers';
import { runWithFreshHostedDomainRootUnwrapCache } from '../../hosted-crypto/domain-root-unwrap-cache';
import { openHostedUserSecureBoxBytes, sealHostedUserSecureBoxBytes } from '../../hosted-crypto/secure-box';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow } from '../../hosted-onboarding/shared';
import { readHostedHealthDataConsentState } from '../../legal/consent';
import { getPrisma } from '../../prisma';
import type { ShareView } from './contract';
import { openProgress } from './crypto';
import { progressEffect } from './http';
import { progressMediaStore, purgeProgressMedia, progressShareBytesTarget } from './media-store';
import { readGameMedia } from '../media';
import type { Candidate } from './registry';
import { shareCard } from './share-card';
import { readProgressShareConsent } from './share-consent';
import { makeShareImage, prepareShareJpeg, SHARE_DEADLINE_MS, ShareImageError } from './share-image';
import type { BeforeProgressMutation } from './state';

// Timed loaders only; readiness comes from a later read.
const SHARE_TYPICAL_SECONDS = 55;

export interface ShareRequest { memberId: string; awardId: string; units: ClientUnits; beforeMutationTx: BeforeProgressMutation }
type Selection = { row: GameProgressShare | null; consent: 'allowed' | 'denied'; photoKey: string | null };
const identity = (input: ShareRequest) => ({ memberId_awardLookup: { memberId: input.memberId, awardLookup: input.awardId } });
export const shareNotFound = () => hostedOnboardingError({ code: 'PROGRESS_SHARE_NOT_FOUND', httpStatus: 404, message: 'That share is not available.' });
const unavailable = () => hostedOnboardingError({ code: 'PROGRESS_SHARE_UNAVAILABLE', httpStatus: 503, retryable: true, message: 'That picture could not load. Try again.' });


async function readAward(input: ShareRequest): Promise<Candidate> {
  const row = await getPrisma().gameProgressAward.findUnique({ where: { memberId_lookup: { memberId: input.memberId, lookup: input.awardId } }, select: { dataEncrypted: true } });
  if (!row) throw shareNotFound();
  const award = await openProgress<Candidate>({ memberId: input.memberId, table: 'game_progress_award', rowId: input.awardId, field: 'data' }, row.dataEncrypted);
  if (award.subjectMemberId !== null || award.measureId === null || !['landmark', 'time', 'route'].includes(award.kind)) throw shareNotFound();
  return award;
}

async function withAuthority<T>(input: ShareRequest, award: Candidate, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return getPrisma().$transaction(async tx => {
    await lockHostedMemberRow(tx, input.memberId);
    await input.beforeMutationTx(tx);
    if (award.measureId === 'steps' || award.measureId === 'sleep') await assertBrowserVaultMemberAuthority({ memberId: input.memberId, prisma: tx });
    return run(tx);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function readSelection(tx: Prisma.TransactionClient, input: ShareRequest): Promise<Selection> {
  const row = await tx.gameProgressShare.findUnique({ where: identity(input) });
  const { decision: consent } = await readProgressShareConsent({ memberId: input.memberId, prisma: tx });
  const profile = row ? null : await tx.gameProfile.findUnique({ where: { memberId: input.memberId }, select: { photoKey: true } });
  const selection = { row, consent, photoKey: profile?.photoKey ?? null } satisfies Selection;
  if (row?.status === 'ready' && consent === 'allowed') await assertPhotoAuthority(tx, input, selection);
  return selection;
}

function presentation(selection: Selection, awardId: string, eligible: boolean, now: number): ShareView['presentation'] {
  const { row, consent, photoKey } = selection;
  if (!eligible || row?.status === 'retired' || row?.status === 'failed') return { state: 'medal' };
  if (consent === 'denied') return { state: 'medal' };
  if (row === null) return { state: photoKey === null ? 'needs_photo' : 'available' };
  if (row.status === 'ready') return { state: 'photo', imagePath: `/api/game/v1/progress/shares/${awardId}/image` };
  const expiresAt = row.createdAt.getTime() + SHARE_DEADLINE_MS;
  return now >= expiresAt ? { state: 'medal' } : { state: 'generating', startedAt: row.createdAt.toISOString(), expiresAt: new Date(expiresAt).toISOString(), typicalSeconds: SHARE_TYPICAL_SECONDS };
}

/** One bounded rolling-window read covers both quotas and active work. Terminal attempts still count. */
export function shareRetryAfter(rows: readonly Pick<GameProgressShare, 'createdAt' | 'status'>[], now: number): number {
  const day = 86_400_000, month = 30 * day;
  const recent = rows.filter(row => row.createdAt.getTime() > now - month).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const deadlines = recent.filter(row => row.status === 'generating').map(row => row.createdAt.getTime() + SHARE_DEADLINE_MS);
  if (recent.length >= 30) deadlines.push(recent[29].createdAt.getTime() + month);
  const daily = recent.filter(row => row.createdAt.getTime() > now - day);
  if (daily.length >= 5) deadlines.push(daily[4].createdAt.getTime() + day);
  return Math.min(month / 1000, Math.max(0, Math.ceil((Math.max(now, ...deadlines) - now) / 1000)));
}

async function assertPhotoAuthority(tx: Prisma.TransactionClient, input: ShareRequest, selection: Selection): Promise<void> {
  if (selection.consent !== 'allowed') throw shareNotFound();
  if (await readHostedHealthDataConsentState({ memberId: input.memberId, prisma: tx }) === 'revoked') {
    throw hostedOnboardingError({ code: 'HOSTED_CONSENT_REQUIRED', httpStatus: 403, message: 'Health data permission is required to make or view this picture.' });
  }
}

export async function readProgressShare(input: ShareRequest): Promise<ShareView> {
  const award = await readAward(input), { card, prompt } = shareCard(award, input.units);
  const selection = await withAuthority(input, award, tx => readSelection(tx, input));
  return { awardId: input.awardId, card, presentation: presentation(selection, input.awardId, prompt !== null, Date.now()) };
}

export async function startProgressShare(input: ShareRequest): Promise<ShareView> {
  const award = await readAward(input), { card, prompt } = shareCard(award, input.units);
  const current = await withAuthority(input, award, tx => readSelection(tx, input));
  const view = { awardId: input.awardId, card, presentation: presentation(current, input.awardId, prompt !== null, Date.now()) };
  if (current.row || view.presentation.state !== 'available' || prompt === null) return view;
  let prepared: Buffer | undefined;
  let transferred = false;
  try {
    // Complete source resolution before permanently spending an attempt or budget.
    const source = await readGameMedia(current.photoKey!).catch(() => { throw unavailable(); });
    if (!source) throw unavailable();
    try { prepared = await prepareShareJpeg(source.bytes); }
    catch { throw unavailable(); }
    finally { source.bytes.fill(0); }
    const admission = await withAuthority(input, award, async tx => {
      const selection = await readSelection(tx, input);
      if (selection.row) return { selection, inserted: false };
      if (selection.photoKey !== current.photoKey) throw unavailable();
      await assertPhotoAuthority(tx, input, selection);
      const now = new Date();
      const rows = await tx.gameProgressShare.findMany({ where: { memberId: input.memberId, createdAt: { gt: new Date(now.getTime() - 30 * 86_400_000) } },
        select: { createdAt: true, status: true }, orderBy: { createdAt: 'desc' }, take: 31 });
      const retryAfterSeconds = shareRetryAfter(rows, now.getTime());
      if (retryAfterSeconds) throw hostedOnboardingError({ code: 'PROGRESS_SHARE_LIMIT', httpStatus: 429, message: 'Another picture can be made later.', details: { retryAfterSeconds } });
      const row = await tx.gameProgressShare.create({ data: { memberId: input.memberId, awardLookup: input.awardId,
        storageKey: `progress/${randomBytes(16).toString('hex')}.jpg`, status: 'generating', createdAt: now } });
      return { selection: { ...selection, row }, inserted: true };
    });
    if (admission.inserted) {
      const reference = prepared;
      after(() => runWithFreshHostedDomainRootUnwrapCache(() => progressEffect(() => generate(input, award, admission.selection.row!, reference))));
      transferred = true;
    }
    return { awardId: input.awardId, card, presentation: presentation(admission.selection, input.awardId, true, Date.now()) };
  } finally { if (!transferred) prepared?.fill(0); }
}

async function liveAttempt(tx: Prisma.TransactionClient, input: ShareRequest, admitted: GameProgressShare): Promise<void> {
  const selection = await readSelection(tx, input);
  await assertPhotoAuthority(tx, input, selection);
  if (Date.now() >= admitted.createdAt.getTime() + SHARE_DEADLINE_MS) throw new ShareImageError('timeout');
  if (selection.row?.status !== 'generating') throw shareNotFound();
}

async function generate(input: ShareRequest, award: Candidate, row: GameProgressShare, reference: Buffer): Promise<void> {
  let output: Buffer | undefined;
  try {
    await withAuthority(input, award, tx => liveAttempt(tx, input, row));
    const deadline = row.createdAt.getTime() + SHARE_DEADLINE_MS;
    // Optional likeness context: one replica read; failure keeps the original prompt.
    const heightCm = await readSavedCompanionBodyHeight(input.memberId, AbortSignal.timeout(Math.max(0, deadline - Date.now()))).catch(() => null);
    await withAuthority(input, award, tx => liveAttempt(tx, input, row));
    const { prompt } = shareCard(award, input.units, heightCm);
    output = await makeShareImage(reference, prompt!, deadline);
    await withAuthority(input, award, tx => liveAttempt(tx, input, row));
    const envelope = await sealHostedUserSecureBoxBytes({ ...progressShareBytesTarget(row.memberId, row.storageKey), value: output });
    await progressMediaStore().putProgressPic({ userId: input.memberId, mediaId: row.storageKey, envelope, hash: createHash('sha256').update(output).digest('hex') });
    await withAuthority(input, award, async tx => {
      await liveAttempt(tx, input, row);
      const changed = await tx.gameProgressShare.updateMany({ where: { memberId: input.memberId, awardLookup: input.awardId, status: 'generating',
        createdAt: { gt: new Date(Date.now() - SHARE_DEADLINE_MS) } }, data: { status: 'ready' } });
      if (changed.count !== 1) throw new ShareImageError('timeout');
    });
  } catch (error) {
    const failureCode = error instanceof ShareImageError ? error.code : 'generation_failed';
    await getPrisma().gameProgressShare.updateMany({ where: { memberId: input.memberId, awardLookup: input.awardId, status: 'generating' }, data: { status: 'failed', failureCode } });
    await purgeProgressMedia(input.memberId, row.storageKey);
  } finally { reference.fill(0); output?.fill(0); }
}

export async function readProgressShareImage(input: ShareRequest): Promise<Uint8Array> {
  const award = await readAward(input);
  const live = () => withAuthority(input, award, async tx => {
    const selection = await readSelection(tx, input);
    if (selection.row?.status !== 'ready' || selection.consent !== 'allowed') throw shareNotFound();
    return selection.row;
  });
  const row = await live();
  const stored = await progressMediaStore().readProgressPic({ userId: input.memberId, mediaId: row.storageKey });
  if (!stored) throw shareNotFound();
  const bytes = await openHostedUserSecureBoxBytes({ ...progressShareBytesTarget(row.memberId, row.storageKey), value: stored.envelope });
  try { await live(); return bytes; }
  catch (error) { bytes.fill(0); throw error; }
}
