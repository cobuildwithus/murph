import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ after: vi.fn(), make: vi.fn(), read: vi.fn(), readProfile: vi.fn(), put: vi.fn(), purge: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<object>(), after: mocks.after }));
vi.mock('../src/lib/game/progress/share-image', async original => ({ ...await original<object>(), makeShareImage: mocks.make }));
vi.mock('../src/lib/game/media', () => ({ readGameMedia: mocks.readProfile }));
vi.mock('../src/lib/game/progress/media-store', async original => ({ ...await original<object>(), progressMediaStore: () => ({ readProgressPic: mocks.read, putProgressPic: mocks.put }), purgeProgressMedia: mocks.purge }));
import { getPrisma } from '../src/lib/prisma';
import { openHostedUserSecureBoxBytes, sealHostedUserSecureBoxBytes } from '../src/lib/hosted-crypto/secure-box';
import * as secureBox from '../src/lib/hosted-crypto/secure-box';
import * as roots from '../src/lib/hosted-crypto/domain-root-store';
import { HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA, type HostedCryptoDomain, type HostedDomainRootKeyEnvelopeV1 } from '@murphai/runtime-state';
import * as imageBoundary from '../src/lib/game/progress/share-image';
import { assertHostedAuthSessionCurrentTx } from '../src/lib/better-auth/session';
import { recordHostedLaunchRequiredConsent, revokeHostedConsentScope } from '../src/lib/legal/consent';
import { readProgressShare, startProgressShare, readProgressShareImage, type ShareRequest } from '../src/lib/game/progress/shares';
import { decideProgressShareConsent } from '../src/lib/game/progress/share-consent';
import { sealProgress, progressLookup } from '../src/lib/game/progress/crypto';
import { ShareImageError } from '../src/lib/game/progress/share-image';
import type { Candidate } from '../src/lib/game/progress/registry';

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === '1';
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? '')) throw new Error('Share proof needs an isolated loopback test database.');
const db = getPrisma(), members: string[] = [];
const stored = new Map<string, string>(), tombstones = new Set<string>();
let tasks: (() => Promise<void>)[] = [], source: Buffer, reference: Uint8Array | undefined, output: Buffer | undefined;
const key = (userId: string, mediaId: string) => `${userId}:${mediaId}`;
beforeEach(async () => {
  vi.resetAllMocks(); tasks = []; stored.clear(); tombstones.clear(); reference = undefined; output = undefined;
  // Keep real byte encryption/AAD; replace only the provider-backed root lookup.
  const root = async ({ userId, domain }: { userId: string; domain: HostedCryptoDomain }) => {
    const envelope: HostedDomainRootKeyEnvelopeV1 = { userId, domain, rootKeyId: 'synthetic-root', generation: 1,
      schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', wraps: [],
      authoritySignature: { alg: 'GCP-KMS-EC-P256-SHA256', keyVersionName: 'synthetic-key', signedAt: '2026-11-01T00:00:00Z', signature: 'synthetic' } };
    return { envelope, rootKey: Buffer.alloc(32, 17) };
  };
  vi.spyOn(roots, 'unwrapHostedDomainRootForWeb').mockImplementation(root);
  vi.spyOn(roots, 'unwrapHostedDomainRootForWebByRootKeyId').mockImplementation(root);
  source = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#96afba' } }).jpeg().toBuffer();
  mocks.readProfile.mockImplementation(async () => ({ bytes: Buffer.from(source), contentType: 'image/jpeg' }));
  mocks.after.mockImplementation(task => tasks.push(task));
  mocks.read.mockImplementation(async ({ userId, mediaId }) => {
    const envelope = stored.get(key(userId, mediaId)); return envelope ? { envelope } : null;
  });
  mocks.put.mockImplementation(async ({ userId, mediaId, envelope }) => {
    const id = key(userId, mediaId); if (tombstones.has(id)) throw new Error('synthetic tombstone'); stored.set(id, envelope);
  });
  mocks.purge.mockImplementation(async (userId, mediaId) => { const id = key(userId, mediaId); tombstones.add(id); stored.delete(id); });
  mocks.make.mockImplementation(async bytes => { reference = bytes; output = Buffer.from(source); return output; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => { if (enabled) await db.hostedMember.deleteMany({ where: { id: { in: members } } }); });

async function fixture(measureId = 'pushups.reps') {
  const memberId = randomUUID(), sourceKey = `profile/${randomUUID()}.jpg`;
  members.push(memberId);
  await db.hostedMember.create({ data: { id: memberId, billingStatus: measureId === 'sleep' || measureId === 'steps' ? 'active' : 'not_started' } });
  const now = new Date(), credential = 'synthetic-session-proof';
  const row = await db.hostedAuthRecord.create({ data: { model: 'session', id: randomUUID(), memberId, payloadEncrypted: 'synthetic-sealed-session',
    createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 86400000) } });
  const beforeMutationTx: ShareRequest['beforeMutationTx'] = tx => assertHostedAuthSessionCurrentTx({ prisma: tx, memberId, sessionId: row.id, credential,
    proof: { row, expiresAt: row.expiresAt!, credentialDigest: createHash('sha256').update(credential).digest() } });
  await db.gameProfile.create({ data: { memberId, photoKey: sourceKey, firstNameEncrypted: 'synthetic-sealed-name', timeZone: 'UTC' } });
  if (measureId === 'sleep' || measureId === 'steps') {
    await recordHostedLaunchRequiredConsent({ memberId, prisma: db, scope: 'launch.legal' });
    await recordHostedLaunchRequiredConsent({ memberId, prisma: db, scope: 'launch.health-data' });
  }
  const decide = (decision: 'allow' | 'deny') => decideProgressShareConsent({ memberId, decision, prisma: db, beforeMutationTx });
  const award = async (name: string, kind = measureId === 'steps' ? 'route' : measureId === 'sleep' ? 'time' : 'landmark') => {
    const awardId = progressLookup(memberId, 'award', [name]);
    const candidate: Candidate = { key: name, kind, measureId, subjectMemberId: null, on: '2026-11-01',
      data: kind === 'route' ? { from: 'Bath', to: 'Bristol', distanceM: 16093.44, startTotal: 0 } : {
        noun: 'PRIVATE_TASK_SENTINEL', rung: { at: 15766, target: { kind: kind === 'time' ? 'time' : 'height', id: kind === 'time' ? 'godwit' : 'mont-blanc' } } } };
    const dataEncrypted = await sealProgress({ memberId, table: 'game_progress_award', rowId: awardId, field: 'data' }, candidate);
    await db.gameProgressAward.create({ data: { memberId, lookup: awardId, dataEncrypted, earnedOn: new Date('2026-11-01') } });
    return { memberId, awardId, beforeMutationTx, units: 'us' as const };
  };
  const input = await award('first');
  const share = () => db.gameProgressShare.findUnique({ where: { memberId_awardLookup: { memberId, awardLookup: input.awardId } } });
  return { memberId, sourceKey, input, award, decide, share, sessionId: row.id };
}

describe.skipIf(!enabled)('stored award share admission and publication', () => {
  it('allows an unrecorded choice, serves the medal when off and never invents a grant', async () => {
    const f = await fixture();
    expect((await readProgressShare(f.input)).presentation).toEqual({ state: 'available' });
    await f.decide('deny');
    expect((await startProgressShare(f.input)).presentation).toEqual({ state: 'medal' });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
    expect(await db.hostedConsentGrant.count({ where: { memberId: f.memberId } })).toBe(0);
  });
  it('resolves simultaneous opens once, keeps saved dates and returns the same encrypted photo', async () => {
    const f = await fixture(); await f.decide('allow');
    const prepared: Buffer[] = [], prepare = imageBoundary.prepareShareJpeg;
    vi.spyOn(imageBoundary, 'prepareShareJpeg').mockImplementation(async bytes => { const result = await prepare(bytes); prepared.push(result); return result; });
    let release!: () => void, reads = 0;
    const bothReading = new Promise<void>(resolve => { release = resolve; }), read = mocks.readProfile.getMockImplementation()!;
    mocks.readProfile.mockImplementation(async request => { if (++reads === 2) release(); await bothReading; return read(request); });
    const before = await db.gameProgressAward.findMany({ where: { memberId: f.memberId } });
    const [a, b] = await Promise.all([startProgressShare(f.input), startProgressShare(f.input)]);
    expect(a.presentation.state).toBe('generating'); expect(b.presentation).toEqual(a.presentation); expect(tasks).toHaveLength(1);
    expect(prepared).toHaveLength(2); expect(prepared.filter(bytes => bytes.every(byte => byte === 0))).toHaveLength(1);
    await tasks[0](); expect(mocks.make).toHaveBeenCalledTimes(1);
    const row = (await f.share())!; expect(row.status).toBe('ready');
    const envelope = stored.get(key(f.memberId, row.storageKey))!;
    expect(envelope).not.toContain(source.toString('base64')); expect(reference!.every(byte => byte === 0)).toBe(true); expect(output!.every(byte => byte === 0)).toBe(true);
    expect(Buffer.from(await readProgressShareImage(f.input))).toEqual(source);
    expect((await startProgressShare(f.input)).presentation.state).toBe('photo'); expect(tasks).toHaveLength(1);
    expect(await db.gameProgressAward.findMany({ where: { memberId: f.memberId } })).toEqual(before);
    expect(await db.gameProgressPic.count({ where: { memberId: f.memberId } })).toBe(0);
    const target = { userId: f.memberId, lane: 'hosted-member-private-field' as const, scope: 'game-progress',
      aad: { purpose: 'game-progress', table: 'game_progress_share', rowId: row.storageKey, field: 'bytes' }, value: envelope };
    for (const change of [{ userId: 'member-leo' }, { aad: { ...target.aad, rowId: 'other' } }, { aad: { ...target.aad, table: 'game_progress_pic' } }]) {
      await expect(openHostedUserSecureBoxBytes({ ...target, ...change })).rejects.toThrow();
    }
  });
  it('admits only one different-award attempt concurrently, without charging the rejected request', async () => {
    const f = await fixture(); await f.decide('allow'); const other = await f.award('second');
    const outcomes = await Promise.allSettled([startProgressShare(f.input), startProgressShare(other)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { httpStatus: 429, details: { retryAfterSeconds: expect.any(Number) } } });
    expect(await db.gameProgressShare.count({ where: { memberId: f.memberId } })).toBe(1); expect(tasks).toHaveLength(1);
    await tasks[0]();
  });
  it.each(['read', 'preparation'])('source %s failure spends no attempt', async phase => {
    const f = await fixture(); await f.decide('allow');
    if (phase === 'read') mocks.readProfile.mockResolvedValueOnce(null);
    else vi.spyOn(imageBoundary, 'prepareShareJpeg').mockRejectedValueOnce(new Error('PRIVATE_SOURCE_SENTINEL'));
    await expect(startProgressShare(f.input)).rejects.toMatchObject({ httpStatus: 503 });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
  });
  it('uses the profile photo without any Progress pics or recorded choice', async () => {
    const f = await fixture('sleep');
    await startProgressShare(f.input);
    expect(mocks.readProfile).toHaveBeenCalledWith(f.sourceKey);
    await tasks[0]();
    expect((await f.share())!.status).toBe('ready');
    expect(await db.gameProgressPic.count({ where: { memberId: f.memberId } })).toBe(0);
  });
  it('needs_photo uses the existing profile upload and spends no quota', async () => {
    const f = await fixture();
    await db.gameProfile.update({ where: { memberId: f.memberId }, data: { photoKey: null } });
    expect((await readProgressShare(f.input)).presentation).toEqual({ state: 'needs_photo' });
    expect((await startProgressShare(f.input)).presentation).toEqual({ state: 'needs_photo' });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0); expect(mocks.readProfile).not.toHaveBeenCalled();
    await db.gameProfile.update({ where: { memberId: f.memberId }, data: { photoKey: f.sourceKey } });
    await startProgressShare(f.input); await tasks[0]();
    expect((await f.share())!.status).toBe('ready');
  });
  it('photo changes during preparation spend no attempt', async () => {
    const f = await fixture();
    mocks.readProfile.mockImplementationOnce(async () => {
      await db.gameProfile.update({ where: { memberId: f.memberId }, data: { photoKey: null } });
      return { bytes: Buffer.from(source), contentType: 'image/jpeg' };
    });
    await expect(startProgressShare(f.input)).rejects.toMatchObject({ httpStatus: 503 });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
  });
  it.each([[5, 0], [30, 2], [31, 2]])('rejects %i persisted attempts aged %i days before insertion or effects', async (count, days) => {
    const f = await fixture(); await f.decide('allow');
    for (let n = 0; n < count; n++) {
      const other = await f.award(`budget-${n}`);
      await db.gameProgressShare.create({ data: { memberId: f.memberId, awardLookup: other.awardId,
        storageKey: `progress/${randomUUID()}.jpg`, status: n % 2 ? 'retired' : 'failed', createdAt: new Date(Date.now() - days * 86400000) } });
    }
    await expect(startProgressShare(f.input)).rejects.toMatchObject({ httpStatus: 429 });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0); expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.purge).not.toHaveBeenCalled();
  });
  it.each(['generation_failed', 'refused', 'timeout'] as const)('terminal %s is a medal with no repeat dispatch', async code => {
    const f = await fixture(); await f.decide('allow');
    mocks.make.mockRejectedValue(new ShareImageError(code));
    await startProgressShare(f.input); await tasks[0]();
    expect(await f.share()).toMatchObject({ status: 'failed', failureCode: code });
    mocks.readProfile.mockRejectedValue(new Error('Duplicate POST must not read source bytes'));
    expect((await startProgressShare(f.input)).presentation).toEqual({ state: 'medal' });
    expect(tasks).toHaveLength(1); expect(mocks.purge).toHaveBeenCalledTimes(1);
  });
  it('an expired process is a medal and a late callback never dispatches', async () => {
    const f = await fixture(); await f.decide('allow'); await startProgressShare(f.input);
    const started = (await f.share())!.createdAt;
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(started.getTime() + 240000);
    expect((await startProgressShare(f.input)).presentation).toEqual({ state: 'medal' });
    await tasks[0](); expect(mocks.make).not.toHaveBeenCalled(); expect(await f.share()).toMatchObject({ failureCode: 'timeout' });
  });
  it.each(['before-dispatch', 'after-provider', 'after-stage'])('deny/regrant at %s cannot revive the old attempt', async phase => {
    const f = await fixture(); await f.decide('allow'); await startProgressShare(f.input);
    const revoke = async () => { await f.decide('deny'); await f.decide('allow'); };
    if (phase === 'before-dispatch') await revoke();
    if (phase === 'after-provider') mocks.make.mockImplementationOnce(async bytes => { reference = bytes; await revoke(); output = Buffer.from(source); return output; });
    if (phase === 'after-stage') {
      const stage = mocks.put.getMockImplementation()!;
      mocks.put.mockImplementationOnce(async request => { await stage(request); await revoke(); });
    }
    await tasks[0](); expect(await f.share()).toMatchObject({ status: 'retired' });
    expect((await readProgressShare(f.input)).presentation).toEqual({ state: 'medal' });
    await expect(readProgressShareImage(f.input)).rejects.toMatchObject({ httpStatus: 404 });
    if (phase === 'before-dispatch') expect(mocks.make).not.toHaveBeenCalled();
    expect(stored.has(key(f.memberId, (await f.share())!.storageKey))).toBe(false);
  });
  it.each(['before-dispatch', 'after-provider', 'ready'])('profile removal at %s leaves admitted pictures alone', async phase => {
    const f = await fixture(); await startProgressShare(f.input);
    const remove = () => db.gameProfile.update({ where: { memberId: f.memberId }, data: { photoKey: null } });
    if (phase === 'before-dispatch') await remove();
    if (phase === 'after-provider') mocks.make.mockImplementationOnce(async () => { await remove(); return Buffer.from(source); });
    await tasks[0]();
    if (phase === 'ready') await remove();
    expect(await f.share()).toMatchObject({ status: 'ready' });
    expect((await readProgressShare(f.input)).presentation.state).toBe('photo');
    expect(Buffer.from(await readProgressShareImage(f.input))).toEqual(source);
    expect((await startProgressShare(f.input)).presentation.state).toBe('photo');
    expect(mocks.make).toHaveBeenCalledTimes(1);
  });
  it('account suspension during pre-admission source access blocks the insert', async () => {
    const f = await fixture(); await f.decide('allow');
    const read = mocks.readProfile.getMockImplementation()!;
    mocks.readProfile.mockImplementationOnce(async request => { await db.hostedMember.update({ where: { id: f.memberId }, data: { suspendedAt: new Date() } }); return read(request); });
    await expect(startProgressShare(f.input)).rejects.toMatchObject({ code: 'HOSTED_MEMBER_SUSPENDED' });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
  });
  it('session revocation after admission blocks dispatch', async () => {
    const f = await fixture(); await f.decide('allow'); await startProgressShare(f.input);
    await db.hostedAuthRecord.delete({ where: { model_id: { model: 'session', id: f.sessionId } } });
    await tasks[0](); expect(mocks.make).not.toHaveBeenCalled(); expect(await f.share()).toMatchObject({ status: 'failed' });
  });
  it('deadline reached during staging rejects ready publication', async () => {
    const f = await fixture(); await f.decide('allow'); await startProgressShare(f.input);
    const started = (await f.share())!.createdAt, put = mocks.put.getMockImplementation()!;
    mocks.put.mockImplementationOnce(async request => { await put(request); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(started.getTime() + 240000); });
    await tasks[0](); expect(await f.share()).toMatchObject({ status: 'failed', failureCode: 'timeout' });
    expect(stored.has(key(f.memberId, (await f.share())!.storageKey))).toBe(false);
  });
  it('revalidates after decryption and clears a late denied image buffer', async () => {
    const f = await fixture(); await f.decide('allow'); await startProgressShare(f.input); await tasks[0]();
    const open = secureBox.openHostedUserSecureBoxBytes; let decrypted: Uint8Array | undefined;
    vi.spyOn(secureBox, 'openHostedUserSecureBoxBytes').mockImplementationOnce(async input => {
      decrypted = await open(input); await f.decide('deny'); return decrypted;
    });
    await expect(readProgressShareImage(f.input)).rejects.toMatchObject({ httpStatus: 404 });
    expect(decrypted!.every(byte => byte === 0)).toBe(true);
  });
  it.each(['sleep', 'steps'])('%s withdrawal blocks even a cached card and image', async measure => {
    const f = await fixture(measure); await f.decide('allow'); await startProgressShare(f.input); await tasks[0]();
    await revokeHostedConsentScope({ memberId: f.memberId, prisma: db, scope: 'launch.health-data' });
    await expect(readProgressShare(f.input)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(readProgressShareImage(f.input)).rejects.toMatchObject({ httpStatus: 403 });
  });
  it('launch health withdrawal blocks exercise dispatch without imposing a paid gate', async () => {
    const f = await fixture(); await f.decide('allow'); await startProgressShare(f.input);
    await recordHostedLaunchRequiredConsent({ memberId: f.memberId, prisma: db, scope: 'launch.health-data' });
    await revokeHostedConsentScope({ memberId: f.memberId, prisma: db, scope: 'launch.health-data' });
    await tasks[0](); expect(mocks.make).not.toHaveBeenCalled();
  });
  it('opaque activity and unearned, unsupported or foreign awards never generate', async () => {
    const f = await fixture('h012345abcdef.reps'); await f.decide('allow');
    expect((await startProgressShare(f.input)).presentation).toEqual({ state: 'medal' });
    const other = await fixture(), unsupported = await f.award('friend', 'friend');
    for (const input of [{ ...f.input, awardId: 'unearned' }, { ...f.input, awardId: other.input.awardId }, unsupported]) {
      await expect(startProgressShare(input)).rejects.toMatchObject({ httpStatus: 404, code: 'PROGRESS_SHARE_NOT_FOUND' });
    }
    expect(tasks).toHaveLength(0);
  });
  it('purge failure is visible, leaves a terminal row and never starts another generation', async () => {
    const f = await fixture(); await f.decide('allow'); await startProgressShare(f.input);
    mocks.make.mockRejectedValue(new Error('PRIVATE_PROVIDER_SENTINEL'));
    mocks.purge.mockRejectedValueOnce(new Error('PRIVATE_STORAGE_SENTINEL'));
    await expect(tasks[0]()).rejects.toMatchObject({ code: 'PROGRESS_UNAVAILABLE', httpStatus: 503 });
    expect(await f.share()).toMatchObject({ status: 'failed', failureCode: 'generation_failed' });
    expect((await startProgressShare(f.input)).presentation).toEqual({ state: 'medal' });
    await f.decide('deny'); expect(mocks.purge).toHaveBeenCalledTimes(2);
  });
});
