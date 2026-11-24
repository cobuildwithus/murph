import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { after } from 'next/server';
import type { GameProgressShare, Prisma } from '@prisma/client';
import type { ClientUnits } from '../../companion/client-info';
import { assertBrowserVaultMemberAuthority } from '../../browser-vault/authority';
import { readSavedCompanionBody } from '../../device-sync/companion-numbers';
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
import type { Candidate } from './registry';
import { SHARE_ZONES, shareCard } from './share-card';
import { purgeProgressShares } from './share-cleanup';
import { readProgressShareConsent } from './share-consent';
import { makeShareImage, SHARE_DEADLINE_MS, ShareImageError } from './share-image';
import { openSharePhoto } from './share-photo';
import type { BeforeProgressMutation } from './state';

// Timed loaders only; readiness comes from a later read. Production's medal
// pictures take 10 to 12 s, like a painted map.
const SHARE_TYPICAL_SECONDS = 14;

export interface ShareRequest { memberId: string; awardId: string; units: ClientUnits; beforeMutationTx: BeforeProgressMutation }
/** row: the attempt the drawer shows. photoKey: the medal photo's current copy. */
type Selection = { row: GameProgressShare | null; consent: 'allowed' | 'denied'; photoKey: string | null; availableAt: number | null };
export const shareNotFound = () => hostedOnboardingError({ code: 'PROGRESS_SHARE_NOT_FOUND', httpStatus: 404, message: 'That share is not available.' });
const unavailable = () => hostedOnboardingError({ code: 'PROGRESS_SHARE_UNAVAILABLE', httpStatus: 503, retryable: true, message: 'That picture could not load. Try again.' });
/** An attempt's public identity: Change photo names the picture it replaces. */
export const shareAttempt = (row: Pick<GameProgressShare, 'createdAt'>) => row.createdAt.getTime().toString(36);


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
    if (award.measureId === 'steps' || award.measureId === 'sleep' || award.data.health === true) await assertBrowserVaultMemberAuthority({ memberId: input.memberId, prisma: tx });
    return run(tx);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

/** The newest attempt, unless it failed or ran out of time while an older picture is ready: then that picture. */
async function shownAttempt(tx: Prisma.TransactionClient, input: ShareRequest): Promise<GameProgressShare | null> {
  const where = { memberId: input.memberId, awardLookup: input.awardId };
  const newest = await tx.gameProgressShare.findFirst({ where, orderBy: { createdAt: 'desc' } });
  if (!newest || newest.status === 'ready' || newest.status === 'retired') return newest;
  if (newest.status === 'generating' && Date.now() < newest.createdAt.getTime() + SHARE_DEADLINE_MS) return newest;
  return await tx.gameProgressShare.findFirst({ where: { ...where, status: 'ready' }, orderBy: { createdAt: 'desc' } }) ?? newest;
}

async function readSelection(tx: Prisma.TransactionClient, input: ShareRequest): Promise<Selection> {
  const row = await shownAttempt(tx, input);
  const { decision: consent } = await readProgressShareConsent({ memberId: input.memberId, prisma: tx });
  const photo = consent === 'allowed' ? await tx.gameProgressSharePhoto.findFirst({ where: { memberId: input.memberId, status: 'current' }, select: { storageKey: true } }) : null;
  const photoKey = photo?.storageKey ?? null;
  // A picture that could start (or change) reads the quota too, so no open promises one that POST would refuse.
  const startable = (row === null && photoKey !== null) || row?.status === 'ready';
  const availableAt = startable && consent === 'allowed' ? await readAvailableAt(tx, input.memberId) : null;
  const selection = { row, consent, photoKey, availableAt } satisfies Selection;
  if (row?.status === 'ready' && consent === 'allowed') await assertPhotoAuthority(tx, input, consent);
  return selection;
}

async function readAvailableAt(tx: Prisma.TransactionClient, memberId: string): Promise<number | null> {
  const now = Date.now();
  const rows = await tx.gameProgressShare.findMany({ where: { memberId, createdAt: { gt: new Date(now - 30 * 86_400_000) } },
    select: { createdAt: true, status: true }, orderBy: { createdAt: 'desc' }, take: 31 });
  return shareAvailableAt(rows, now);
}

function presentation(selection: Selection, awardId: string, eligible: boolean, now: number): ShareView['presentation'] {
  const { row, consent, photoKey, availableAt } = selection;
  if (!eligible || row?.status === 'retired' || row?.status === 'failed') return { state: 'medal' };
  if (consent === 'denied') return { state: 'medal' };
  if (row === null && photoKey === null) return { state: 'needs_photo' };
  if (row === null) return availableAt === null ? { state: 'available' } : { state: 'later', availableAt: new Date(availableAt).toISOString() };
  if (row.status === 'ready') return { state: 'photo', imagePath: `/api/game/v1/progress/shares/${awardId}/image`, attempt: shareAttempt(row),
    ...(availableAt !== null && { availableAt: new Date(availableAt).toISOString() }) };
  const expiresAt = row.createdAt.getTime() + SHARE_DEADLINE_MS;
  return now >= expiresAt ? { state: 'medal' } : { state: 'generating', startedAt: row.createdAt.toISOString(), expiresAt: new Date(expiresAt).toISOString(), typicalSeconds: SHARE_TYPICAL_SECONDS };
}

/** One bounded rolling-window read covers both quotas and active work. Terminal attempts still count.
 * Null while POST would admit; otherwise when it next will, at most 30 days on. */
export function shareAvailableAt(rows: readonly Pick<GameProgressShare, 'createdAt' | 'status'>[], now: number): number | null {
  const day = 86_400_000, month = 30 * day;
  const recent = rows.filter(row => row.createdAt.getTime() > now - month).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const deadlines = recent.filter(row => row.status === 'generating').map(row => row.createdAt.getTime() + SHARE_DEADLINE_MS);
  if (recent.length >= 30) deadlines.push(recent[29].createdAt.getTime() + month);
  const daily = recent.filter(row => row.createdAt.getTime() > now - day);
  if (daily.length >= 5) deadlines.push(daily[4].createdAt.getTime() + day);
  const at = Math.min(now + month, Math.max(now, ...deadlines));
  return at > now ? at : null;
}

async function assertPhotoAuthority(tx: Prisma.TransactionClient, input: ShareRequest, consent: Selection['consent']): Promise<void> {
  if (consent !== 'allowed') throw shareNotFound();
  if (await readHostedHealthDataConsentState({ memberId: input.memberId, prisma: tx }) === 'revoked') {
    throw hostedOnboardingError({ code: 'HOSTED_CONSENT_REQUIRED', httpStatus: 403, message: 'Health data permission is required to make or view this picture.' });
  }
}

/** The photo is titled, but only the illustrated medal side has a subtitle. */
function shareView(awardId: string, card: ShareView['card'], selection: Selection, eligible: boolean): ShareView {
  const state = presentation(selection, awardId, eligible, Date.now());
  return { awardId, card: state.state === 'photo' ? { ...card, line: '' } : card, zones: SHARE_ZONES, presentation: state };
}

export async function readProgressShare(input: ShareRequest): Promise<ShareView> {
  const award = await readAward(input), { card, prompt } = shareCard(award, input.units);
  const selection = await withAuthority(input, award, tx => readSelection(tx, input));
  return shareView(input.awardId, card, selection, prompt !== null);
}

/** What this POST may start: the first picture, or a new one in place of the shown picture (Change photo). */
function admits(selection: Selection, replaces: string | undefined): boolean {
  if (selection.consent !== 'allowed' || selection.photoKey === null || selection.availableAt !== null) return false;
  return replaces === undefined ? selection.row === null : selection.row?.status === 'ready' && shareAttempt(selection.row) === replaces;
}

/** An empty body starts the first picture. `replaces` makes a new one from the current medal photo; a retry finds it
 * generating and starts nothing. */
export async function startProgressShare(input: ShareRequest, replaces?: string): Promise<ShareView> {
  const award = await readAward(input), { card, prompt } = shareCard(award, input.units);
  const current = await withAuthority(input, award, tx => readSelection(tx, input));
  if (prompt === null || !admits(current, replaces)) return shareView(input.awardId, card, current, prompt !== null);
  let reference: Buffer | null = null;
  let transferred = false;
  try {
    // The copy was prepared when picked. Read it before permanently spending an attempt or budget.
    reference = await openSharePhoto(input.memberId, current.photoKey!).catch(() => { throw unavailable(); });
    if (!reference) throw unavailable();
    const admission = await withAuthority(input, award, async tx => {
      const selection = await readSelection(tx, input);
      // Another request admitted meanwhile, or the quota filled: the fresh view says so.
      if (!admits(selection, replaces) || selection.row?.storageKey !== current.row?.storageKey) return { selection, inserted: false };
      if (selection.photoKey !== current.photoKey) throw unavailable();
      await assertPhotoAuthority(tx, input, selection.consent);
      const row = await tx.gameProgressShare.create({ data: { memberId: input.memberId, awardLookup: input.awardId,
        storageKey: `progress/${randomBytes(16).toString('hex')}.jpg`, status: 'generating', createdAt: new Date() } });
      return { selection: { ...selection, row }, inserted: true };
    });
    if (admission.inserted) {
      const source = reference;
      after(() => runWithFreshHostedDomainRootUnwrapCache(() => progressEffect('generate_share', () => generate(input, award, admission.selection.row!, source))));
      transferred = true;
    }
    return shareView(input.awardId, card, admission.selection, true);
  } finally { if (!transferred) reference?.fill(0); }
}

/** The attempt's own row, by its key: an older attempt can never publish or fail a newer one. */
async function liveAttempt(tx: Prisma.TransactionClient, input: ShareRequest, admitted: GameProgressShare): Promise<void> {
  const { decision } = await readProgressShareConsent({ memberId: input.memberId, prisma: tx });
  await assertPhotoAuthority(tx, input, decision);
  if (Date.now() >= admitted.createdAt.getTime() + SHARE_DEADLINE_MS) throw new ShareImageError('timeout');
  const own = await tx.gameProgressShare.findUnique({ where: { storageKey: admitted.storageKey }, select: { status: true } });
  if (own?.status !== 'generating') throw shareNotFound();
}

async function generate(input: ShareRequest, award: Candidate, row: GameProgressShare, reference: Buffer): Promise<void> {
  let output: Buffer | undefined;
  let replaced: string[] = [];
  try {
    await withAuthority(input, award, tx => liveAttempt(tx, input, row));
    const deadline = row.createdAt.getTime() + SHARE_DEADLINE_MS;
    // Optional likeness context: one replica read; failure keeps the original prompt.
    const body = await readSavedCompanionBody(input.memberId, AbortSignal.timeout(Math.max(0, deadline - Date.now()))).catch(() => undefined);
    await withAuthority(input, award, tx => liveAttempt(tx, input, row));
    const { prompt } = shareCard(award, input.units, body);
    output = await makeShareImage(reference, prompt!, deadline);
    await withAuthority(input, award, tx => liveAttempt(tx, input, row));
    const envelope = await sealHostedUserSecureBoxBytes({ ...progressShareBytesTarget(row.memberId, row.storageKey), value: output });
    await progressMediaStore().putProgressPic({ userId: input.memberId, mediaId: row.storageKey, envelope, hash: createHash('sha256').update(output).digest('hex') });
    replaced = await withAuthority(input, award, async tx => {
      await liveAttempt(tx, input, row);
      const changed = await tx.gameProgressShare.updateMany({ where: { storageKey: row.storageKey, status: 'generating',
        createdAt: { gt: new Date(Date.now() - SHARE_DEADLINE_MS) } }, data: { status: 'ready' } });
      if (changed.count !== 1) throw new ShareImageError('timeout');
      // The picture it replaces retires; its row keeps the key and still counts toward the quota.
      const older = await tx.gameProgressShare.findMany({ where: { memberId: input.memberId, awardLookup: input.awardId, status: 'ready',
        storageKey: { not: row.storageKey } }, select: { storageKey: true } });
      await tx.gameProgressShare.updateMany({ where: { storageKey: { in: older.map(old => old.storageKey) } }, data: { status: 'retired' } });
      return older.map(old => old.storageKey);
    });
  } catch (error) {
    const failureCode = error instanceof ShareImageError ? error.code : 'generation_failed';
    await getPrisma().gameProgressShare.updateMany({ where: { storageKey: row.storageKey, status: 'generating' }, data: { status: 'failed', failureCode } });
    await purgeProgressMedia(input.memberId, row.storageKey);
    return;
  } finally { reference.fill(0); output?.fill(0); }
  // Retired rows keep their keys, so a failed purge replays on the next Turn off or account deletion.
  await purgeProgressShares(input.memberId, replaced).catch(() => undefined);
}

export async function readProgressShareImage(input: ShareRequest): Promise<Uint8Array> {
  const award = await readAward(input);
  const live = () => withAuthority(input, award, async tx => {
    const row = await tx.gameProgressShare.findFirst({ where: { memberId: input.memberId, awardLookup: input.awardId, status: 'ready' },
      orderBy: { createdAt: 'desc' } });
    if (!row) throw shareNotFound();
    const { decision } = await readProgressShareConsent({ memberId: input.memberId, prisma: tx });
    await assertPhotoAuthority(tx, input, decision);
    return row;
  });
  const row = await live();
  const stored = await progressMediaStore().readProgressPic({ userId: input.memberId, mediaId: row.storageKey });
  if (!stored) throw shareNotFound();
  const bytes = await openHostedUserSecureBoxBytes({ ...progressShareBytesTarget(row.memberId, row.storageKey), value: stored.envelope });
  try {
    if ((await live()).storageKey !== row.storageKey) throw shareNotFound();
    return bytes;
  } catch (error) { bytes.fill(0); throw error; }
}
