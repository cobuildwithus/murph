import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../src/lib/prisma';
import { PROGRESS_SHARE_CONSENT_SCOPE } from '../src/lib/legal/consent';
import { decideProgressShareConsent } from '../src/lib/game/progress/share-consent';
import { deleteProgressSharesForAccount } from '../src/lib/game/progress/share-cleanup';
import * as cleanup from '../src/lib/game/progress/share-cleanup';

const mocks = vi.hoisted(() => ({ purge: vi.fn() }));
vi.mock('../src/lib/game/progress/media-store', () => ({ purgeProgressMedia: mocks.purge }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === '1';
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Share proof needs an isolated loopback test database.');
}
const db = getPrisma(), members: string[] = [];
const noExtraAuth = async () => {};
async function fixture() {
  const memberId = randomUUID(), sourcePicId = randomUUID(), awardLookup = 'opaque-award';
  members.push(memberId);
  await db.hostedMember.create({ data: { id: memberId } });
  await db.gameProgressAward.create({ data: { memberId, lookup: awardLookup, earnedOn: new Date('2026-11-01'), dataEncrypted: 'synthetic-sealed-award' } });
  await db.gameProgressPic.create({ data: { id: sourcePicId, memberId, takenAt: new Date(), storageKey: `progress/${randomUUID()}.jpg`, metaEncrypted: 'synthetic-sealed-meta' } });
  const share = await db.gameProgressShare.create({ data: { memberId, awardLookup, storageKey: `progress/${randomUUID()}.jpg`, status: 'generating' } });
  const decide = (decision: 'allow' | 'deny') => decideProgressShareConsent({ memberId, decision, prisma: db, beforeMutationTx: noExtraAuth });
  const read = () => db.gameProgressShare.findUniqueOrThrow({ where: { memberId_awardLookup: { memberId, awardLookup } } });
  const events = () => db.hostedConsentEvent.findMany({ where: { memberId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return { memberId, sourcePicId, awardLookup, share, decide, read, events };
}
afterEach(() => { vi.restoreAllMocks(); mocks.purge.mockReset(); });
afterAll(async () => { if (enabled) await db.hostedMember.deleteMany({ where: { id: { in: members } } }); });

describe.skipIf(!enabled)('Progress consent and cleanup PostgreSQL atomicity', () => {
  it('persists first No without a fabricated grant and deduplicates cross-device decisions', async () => {
    const f = await fixture();
    await Promise.all([f.decide('deny'), f.decide('deny')]);
    expect(await f.events()).toMatchObject([{ action: 'declined', source: 'ios-progress-share', metadataJson: { disclosureVersion: 1 } }]);
    expect(await db.hostedConsentGrant.count({ where: { memberId: f.memberId } })).toBe(0);
    expect((await f.read()).status).toBe('retired');
    expect(mocks.purge).toHaveBeenCalledTimes(2);
  });

  it('rolls back consent and the audit if retirement fails after the consent write', async () => {
    const f = await fixture(); await f.decide('allow');
    const before = await f.events();
    vi.spyOn(cleanup, 'retireProgressSharesTx').mockImplementationOnce(async tx => {
      expect(await tx.hostedConsentGrant.findUnique({ where: { memberId_scope: { memberId: f.memberId, scope: PROGRESS_SHARE_CONSENT_SCOPE } } }))
        .toMatchObject({ status: 'revoked' });
      throw new Error('injected retirement failure');
    });
    await expect(f.decide('deny')).rejects.toThrow('injected retirement failure');
    expect(await f.events()).toEqual(before);
    expect((await f.read()).status).toBe('generating');
    expect(await db.hostedConsentGrant.findFirst({ where: { memberId: f.memberId } })).toMatchObject({ status: 'granted' });
    expect(mocks.purge).not.toHaveBeenCalled();
  });

  it('regrant cannot revive generating work retired by denial; audit no-op still replays a failed purge', async () => {
    const f = await fixture(); await f.decide('allow'); await f.decide('allow');
    mocks.purge.mockRejectedValueOnce(new Error('injected purge failure'));
    await expect(f.decide('deny')).rejects.toThrow('injected purge failure');
    expect((await f.read()).status).toBe('retired');
    const denied = await f.events(); expect(denied.map(e => e.action)).toEqual(['granted', 'revoked']);
    await f.decide('deny'); expect(await f.events()).toEqual(denied);
    expect(mocks.purge).toHaveBeenCalledTimes(2);
    await f.decide('allow');
    expect((await f.read()).status).toBe('retired');
    expect(await db.gameProgressShare.updateMany({ where: { memberId: f.memberId, status: 'generating' }, data: { status: 'ready' } })).toEqual({ count: 0 });
    expect(await db.gameProgressAward.findFirst({ where: { memberId: f.memberId } })).toMatchObject({ earnedOn: new Date('2026-11-01') });
  });

  it('Progress pic deletion does not affect shares; account cleanup purges them before cascade', async () => {
    const f = await fixture();
    await db.gameProgressPic.delete({ where: { id: f.sourcePicId } });
    expect((await f.read()).status).toBe('generating');
    mocks.purge.mockRejectedValueOnce(new Error('injected purge failure'));
    await expect(deleteProgressSharesForAccount([f.memberId], db)).rejects.toThrow('injected purge failure');
    expect(await f.read()).toMatchObject({ status: 'retired', storageKey: f.share.storageKey });
    await deleteProgressSharesForAccount([f.memberId], db);
    expect(mocks.purge).toHaveBeenLastCalledWith(f.memberId, f.share.storageKey);
    expect(await db.gameProgressAward.count({ where: { memberId: f.memberId } })).toBe(1);
  });

  it('binds each share to its owner award and removes rows on account cascade', async () => {
    const f = await fixture(), other = await fixture();
    await expect(db.gameProgressShare.create({ data: { ...f.share, memberId: other.memberId, awardLookup: 'unearned', storageKey: `progress/${randomUUID()}.jpg` } })).rejects.toMatchObject({ code: 'P2003' });
    await db.hostedMember.delete({ where: { id: f.memberId } });
    expect(await db.gameProgressShare.count({ where: { memberId: f.memberId } })).toBe(0);
    expect((await other.read()).status).toBe('generating');
  });
});
