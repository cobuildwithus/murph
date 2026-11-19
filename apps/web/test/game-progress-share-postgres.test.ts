import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ after: vi.fn(), make: vi.fn(), read: vi.fn(), readProfile: vi.fn(), put: vi.fn(), purge: vi.fn(), height: vi.fn() }));
vi.mock('../src/lib/device-sync/companion-numbers', () => ({ readSavedCompanionBodyHeight: mocks.height }));
vi.mock('next/server', async original => ({ ...await original<object>(), after: mocks.after }));
vi.mock('../src/lib/game/progress/share-image', async original => ({ ...await original<object>(), makeShareImage: mocks.make }));
vi.mock('../src/lib/game/media', () => ({ readGameMedia: mocks.readProfile }));
vi.mock('../src/lib/game/progress/media-store', async original => ({ ...await original<object>(), progressMediaStore: () => ({ readProgressPic: mocks.read, putProgressPic: mocks.put }), purgeProgressMedia: mocks.purge }));
import { getPrisma } from '../src/lib/prisma';
import { openHostedUserSecureBoxBytes } from '../src/lib/hosted-crypto/secure-box';
import * as secureBox from '../src/lib/hosted-crypto/secure-box';
import * as roots from '../src/lib/hosted-crypto/domain-root-store';
import { HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA, type HostedCryptoDomain, type HostedDomainRootKeyEnvelopeV1 } from '@murphai/runtime-state';
import { assertHostedAuthSessionCurrentTx } from '../src/lib/better-auth/session';
import { recordHostedLaunchRequiredConsent, revokeHostedConsentScope } from '../src/lib/legal/consent';
import { readProgressShare, startProgressShare, readProgressShareImage, type ShareRequest } from '../src/lib/game/progress/shares';
import { decideProgressShareConsent } from '../src/lib/game/progress/share-consent';
import { putSharePhoto, readSharePhoto } from '../src/lib/game/progress/share-photo';
import { sealProgress, progressLookup } from '../src/lib/game/progress/crypto';
import { ShareImageError } from '../src/lib/game/progress/share-image';
import type { Candidate } from '../src/lib/game/progress/registry';
import { lockHostedMemberRow } from '../src/lib/hosted-onboarding/shared';

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === '1';
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_[a-z0-9_]+$/u.test(process.env.DATABASE_URL ?? '')) throw new Error('Share proof needs an isolated loopback test database.');
const db = getPrisma(), members: string[] = [];
const stored = new Map<string, string>(), tombstones = new Set<string>();
let tasks: (() => Promise<void>)[] = [], source: Buffer, reference: Uint8Array | undefined, output: Buffer | undefined;
const key = (userId: string, mediaId: string) => `${userId}:${mediaId}`;
beforeEach(async () => {
  vi.resetAllMocks(); tasks = []; stored.clear(); tombstones.clear(); reference = undefined; output = undefined;
  mocks.height.mockResolvedValue(null);
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

async function fixture(measureId = 'pushups.reps', { photo = true } = {}) {
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
  const share = () => db.gameProgressShare.findFirst({ where: { memberId, awardLookup: input.awardId }, orderBy: { createdAt: 'desc' } });
  const pick = () => putSharePhoto(memberId, { from: 'profile' }, beforeMutationTx);
  const photos = () => db.gameProgressSharePhoto.findMany({ where: { memberId }, orderBy: { createdAt: 'asc' } });
  // The medal photo: one real pick, then a clean slate for the source and store mocks.
  if (photo) { await pick(); mocks.readProfile.mockClear(); mocks.put.mockClear(); mocks.read.mockClear(); }
  return { memberId, sourceKey, input, award, decide, share, pick, photos, sessionId: row.id };
}

describe.skipIf(!enabled)('stored award share admission and publication', () => {
  it.each(['height', 'missing', 'read failure'])('generates after admission with %s and keeps height out of the card', async state => {
    const f = await fixture(), before = await readProgressShare(f.input);
    const admitted = await startProgressShare(f.input);
    expect(mocks.height).not.toHaveBeenCalled();
    mocks.height.mockImplementationOnce(async () => {
      expect(await f.share()).toMatchObject({ status: 'generating' });
      // This lock can be acquired only after the share's authority transaction releases it.
      await db.$transaction(tx => lockHostedMemberRow(tx, f.memberId), { timeout: 1000 });
      if (state === 'read failure') throw new Error('PRIVATE_REPLICA_SENTINEL');
      return state === 'height' ? 170.4 : null;
    });
    await tasks[0]();
    expect(mocks.height).toHaveBeenCalledExactlyOnceWith(f.memberId, expect.any(AbortSignal));
    expect(mocks.make).toHaveBeenCalledTimes(1);
    const prompt = mocks.make.mock.calls[0][1] as string;
    expect(prompt.includes('The person is 170 cm tall; keep their real height and build.')).toBe(state === 'height');
    expect(prompt).not.toContain('PRIVATE_REPLICA_SENTINEL');
    expect(await f.share()).toMatchObject({ status: 'ready', failureCode: null });
    expect(admitted.card).toEqual(before.card);
    expect((await readProgressShare(f.input)).card).toEqual(before.card);
    await startProgressShare(f.input);
    expect(mocks.height).toHaveBeenCalledTimes(1);
  });
  it.each(['session', 'health consent'])('rechecks %s after the height read before provider dispatch', async authority => {
    const f = await fixture();
    await recordHostedLaunchRequiredConsent({ memberId: f.memberId, prisma: db, scope: 'launch.health-data' });
    await startProgressShare(f.input);
    mocks.height.mockImplementationOnce(async () => {
      if (authority === 'session') await db.hostedAuthRecord.delete({ where: { model_id: { model: 'session', id: f.sessionId } } });
      else await revokeHostedConsentScope({ memberId: f.memberId, prisma: db, scope: 'launch.health-data' });
      return 170;
    });
    await tasks[0]();
    expect(mocks.make).not.toHaveBeenCalled();
    expect(await f.share()).toMatchObject({ status: 'failed' });
  });
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
    const opened: Uint8Array[] = [], open = secureBox.openHostedUserSecureBoxBytes;
    vi.spyOn(secureBox, 'openHostedUserSecureBoxBytes').mockImplementation(async request => {
      const bytes = await open(request); if (request.aad.table === 'game_progress_share_photo') opened.push(bytes); return bytes;
    });
    let release!: () => void, reads = 0;
    const bothReading = new Promise<void>(resolve => { release = resolve; }), read = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation(async request => { if (++reads <= 2) { if (reads === 2) release(); await bothReading; } return read(request); });
    const before = await db.gameProgressAward.findMany({ where: { memberId: f.memberId } });
    const [a, b] = await Promise.all([startProgressShare(f.input), startProgressShare(f.input)]);
    expect(a.presentation.state).toBe('generating'); expect(b.presentation).toEqual(a.presentation); expect(tasks).toHaveLength(1);
    expect(opened).toHaveLength(2); expect(opened.filter(bytes => bytes.every(byte => byte === 0))).toHaveLength(1);
    await tasks[0](); expect(mocks.make).toHaveBeenCalledTimes(1);
    const row = (await f.share())!; expect(row.status).toBe('ready');
    const envelope = stored.get(key(f.memberId, row.storageKey))!;
    expect(envelope).not.toContain(source.toString('base64')); expect(reference!.every(byte => byte === 0)).toBe(true); expect(output!.every(byte => byte === 0)).toBe(true);
    expect(Buffer.from(await readProgressShareImage(f.input))).toEqual(source);
    expect((await startProgressShare(f.input)).presentation.state).toBe('photo'); expect(tasks).toHaveLength(1);
    expect(await db.gameProgressAward.findMany({ where: { memberId: f.memberId } })).toEqual(before);
    expect(await db.gameProgressPic.count({ where: { memberId: f.memberId } })).toBe(0);
    expect(opened.every(bytes => bytes.every(byte => byte === 0))).toBe(true);
    const target = { userId: f.memberId, lane: 'hosted-member-private-field' as const, scope: 'game-progress',
      aad: { purpose: 'game-progress', table: 'game_progress_share', rowId: row.storageKey, field: 'bytes' }, value: envelope };
    for (const change of [{ userId: 'member-leo' }, { aad: { ...target.aad, rowId: 'other' } }, { aad: { ...target.aad, table: 'game_progress_pic' } }]) {
      await expect(openHostedUserSecureBoxBytes({ ...target, ...change })).rejects.toThrow();
    }
  });
  it('GET never starts a picture: only POST spends an attempt', async () => {
    const f = await fixture(); await f.decide('allow');
    for (let n = 0; n < 3; n++) expect((await readProgressShare(f.input)).presentation).toEqual({ state: 'available' });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
    expect(mocks.readProfile).not.toHaveBeenCalled(); expect(mocks.make).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled();
    expect((await startProgressShare(f.input)).presentation.state).toBe('generating'); expect(tasks).toHaveLength(1);
  });
  it('admits only one different-award attempt concurrently; the other is later until that one is made', async () => {
    const f = await fixture(); await f.decide('allow'); const other = await f.award('second');
    const views = await Promise.all([startProgressShare(f.input), startProgressShare(other)]);
    expect(views.map(view => view.presentation.state).sort()).toEqual(['generating', 'later']);
    expect(await db.gameProgressShare.count({ where: { memberId: f.memberId } })).toBe(1); expect(tasks).toHaveLength(1);
    const admitted = (await db.gameProgressShare.findFirstOrThrow({ where: { memberId: f.memberId } })).createdAt.getTime();
    const waiting = views.find(view => view.presentation.state === 'later')!, again = waiting.awardId === f.input.awardId ? f.input : other;
    expect(Date.parse((waiting.presentation as { availableAt: string }).availableAt)).toBe(admitted + 240_000);
    expect((await readProgressShare(again)).presentation.state).toBe('later');
    await tasks[0]();
    expect((await readProgressShare(again)).presentation).toEqual({ state: 'available' });
  });
  it('a sixth picture in a day is later on GET and POST, reads no photo and starts once the day has passed', async () => {
    const f = await fixture(); await f.decide('allow');
    for (let n = 0; n < 5; n++) { await startProgressShare(await f.award(`made-${n}`)); await tasks.at(-1)!(); }
    expect(await db.gameProgressShare.count({ where: { memberId: f.memberId, status: 'ready' } })).toBe(5);
    // Made 23 hours ago, so the day passes within the session's life.
    const madeAt = Date.now() - 23 * 3_600_000;
    await db.gameProgressShare.updateMany({ where: { memberId: f.memberId }, data: { createdAt: new Date(madeAt) } });
    mocks.read.mockClear();
    const later = await readProgressShare(f.input);
    expect(later.presentation.state).toBe('later');
    const availableAt = Date.parse((later.presentation as { availableAt: string }).availableAt);
    expect(availableAt).toBe(madeAt + 86_400_000);
    expect((await startProgressShare(f.input)).presentation).toEqual(later.presentation);
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(5); expect(mocks.read).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(availableAt);
    expect((await readProgressShare(f.input)).presentation).toEqual({ state: 'available' });
    expect((await startProgressShare(f.input)).presentation.state).toBe('generating');
  });
  it.each(['missing', 'store failure'])('a medal photo copy %s spends no attempt and keeps the pick', async phase => {
    const f = await fixture(); await f.decide('allow');
    if (phase === 'missing') mocks.read.mockResolvedValueOnce(null);
    else mocks.read.mockRejectedValueOnce(new Error('PRIVATE_SOURCE_SENTINEL'));
    await expect(startProgressShare(f.input)).rejects.toMatchObject({ httpStatus: 503 });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
    expect((await f.photos()).map(row => row.status)).toEqual(['current']);
  });
  it('starts from the sealed medal photo: no game media read, no Progress pics, no recorded choice', async () => {
    const f = await fixture('sleep');
    await startProgressShare(f.input);
    expect(mocks.readProfile).not.toHaveBeenCalled();
    await tasks[0]();
    expect((await f.share())!.status).toBe('ready');
    expect(Buffer.from(reference!).every(byte => byte === 0)).toBe(true);
    expect(await db.gameProgressPic.count({ where: { memberId: f.memberId } })).toBe(0);
  });
  it('needs_photo until a pick, and the pick never touches the profile photo', async () => {
    const f = await fixture('pushups.reps', { photo: false });
    expect((await readProgressShare(f.input)).presentation).toEqual({ state: 'needs_photo' });
    expect((await startProgressShare(f.input)).presentation).toEqual({ state: 'needs_photo' });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
    await f.pick();
    expect(mocks.readProfile).toHaveBeenCalledExactlyOnceWith(f.sourceKey);
    expect((await db.gameProfile.findUniqueOrThrow({ where: { memberId: f.memberId } })).photoKey).toBe(f.sourceKey);
    expect((await readProgressShare(f.input)).presentation).toEqual({ state: 'available' });
    await startProgressShare(f.input); await tasks[0]();
    expect((await f.share())!.status).toBe('ready');
  });
  it('a new pick between the photo read and admission spends no attempt', async () => {
    const f = await fixture();
    const read = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementationOnce(async request => { const result = await read(request); await f.pick(); return result; });
    await expect(startProgressShare(f.input)).rejects.toMatchObject({ httpStatus: 503 });
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0);
  });
  it.each([[5, 0, 4, 1], [30, 2, 29, 30], [31, 2, 29, 30]])('%i persisted attempts aged %i days are later before insertion or effects', async (count, days, nth, windowDays) => {
    const f = await fixture(); await f.decide('allow');
    const createdAt: number[] = [];
    for (let n = 0; n < count; n++) {
      const other = await f.award(`budget-${n}`);
      createdAt.unshift(Date.now() - days * 86400000);
      await db.gameProgressShare.create({ data: { memberId: f.memberId, awardLookup: other.awardId,
        storageKey: `progress/${randomUUID()}.jpg`, status: n % 2 ? 'retired' : 'failed', createdAt: new Date(createdAt[0]) } });
    }
    const view = await startProgressShare(f.input);
    expect(view.presentation.state).toBe('later');
    expect(Date.parse((view.presentation as { availableAt: string }).availableAt)).toBe(createdAt[nth] + windowDays * 86400000);
    expect((await readProgressShare(f.input)).presentation).toEqual(view.presentation);
    expect(await f.share()).toBeNull(); expect(tasks).toHaveLength(0); expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.purge).not.toHaveBeenCalled();
  });
  it.each(['generation_failed', 'refused', 'timeout'] as const)('terminal %s is a medal with no repeat dispatch', async code => {
    const f = await fixture(); await f.decide('allow');
    mocks.make.mockRejectedValue(new ShareImageError(code));
    await startProgressShare(f.input); await tasks[0]();
    expect(await f.share()).toMatchObject({ status: 'failed', failureCode: code });
    mocks.read.mockRejectedValue(new Error('Duplicate POST must not read source bytes'));
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
    const read = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementationOnce(async request => { await db.hostedMember.update({ where: { id: f.memberId }, data: { suspendedAt: new Date() } }); return read(request); });
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
    // Turn off purges the failed attempt's key again and the medal photo's copy.
    await f.decide('deny'); expect(mocks.purge).toHaveBeenCalledTimes(3);
  });
});

describe.skipIf(!enabled)('Change photo attempts', () => {
  const made = async (f: Awaited<ReturnType<typeof fixture>>) => {
    await startProgressShare(f.input); await tasks.at(-1)!();
    const view = await readProgressShare(f.input);
    expect(view.presentation.state).toBe('photo');
    return (view.presentation as { attempt: string }).attempt;
  };
  it('makes exactly one new picture, keeps the old one until it is ready, and a retry starts nothing', async () => {
    const f = await fixture(), first = await made(f), old = (await f.share())!;
    await f.pick();
    const [a, b] = await Promise.all([startProgressShare(f.input, first), startProgressShare(f.input, first)]);
    expect(a.presentation.state).toBe('generating'); expect(b.presentation).toEqual(a.presentation); expect(tasks).toHaveLength(2);
    expect(stored.has(key(f.memberId, old.storageKey))).toBe(true);
    await tasks[1]();
    const now = await readProgressShare(f.input), attempt = (now.presentation as { attempt: string }).attempt;
    expect(now.presentation.state).toBe('photo'); expect(attempt).not.toBe(first);
    expect(await db.gameProgressShare.findUnique({ where: { storageKey: old.storageKey } })).toMatchObject({ status: 'retired' });
    expect(stored.has(key(f.memberId, old.storageKey))).toBe(false);
    expect((await startProgressShare(f.input, first)).presentation).toEqual(now.presentation);
    expect(tasks).toHaveLength(2); expect(mocks.make).toHaveBeenCalledTimes(2);
    expect(await db.gameProgressShare.count({ where: { memberId: f.memberId } })).toBe(2);
  });
  it('a failed Change photo shows the picture it would have replaced', async () => {
    const f = await fixture(), first = await made(f);
    mocks.make.mockRejectedValueOnce(new ShareImageError('refused'));
    await startProgressShare(f.input, first); await tasks[1]();
    const view = await readProgressShare(f.input);
    expect(view.presentation).toMatchObject({ state: 'photo', attempt: first });
    expect(Buffer.from(await readProgressShareImage(f.input))).toEqual(source);
  });
  it('says when Change photo can next make one and spends nothing before then', async () => {
    const f = await fixture(); await made(f);
    for (let n = 0; n < 4; n++) await made({ ...f, input: await f.award(`more-${n}`) });
    const view = await readProgressShare(f.input), presentation = view.presentation as { attempt: string; availableAt?: string };
    expect(presentation.availableAt).toBeDefined();
    expect((await startProgressShare(f.input, presentation.attempt)).presentation).toEqual(view.presentation);
    expect(tasks).toHaveLength(5);
  });
  it('Turn off retires every attempt and purges every key', async () => {
    const f = await fixture(), first = await made(f);
    await f.pick(); await startProgressShare(f.input, first); await tasks[1]();
    await f.decide('deny');
    const rows = await db.gameProgressShare.findMany({ where: { memberId: f.memberId } });
    expect(rows.map(row => row.status)).toEqual(['retired', 'retired']);
    for (const row of rows) expect(stored.has(key(f.memberId, row.storageKey))).toBe(false);
  });
});

describe.skipIf(!enabled)('medal photo copies', () => {
  it('a second pick retires and forgets the first copy; GET returns the current one', async () => {
    const f = await fixture(), [first] = await f.photos();
    await f.pick();
    const rows = await f.photos();
    expect(rows.map(row => row.status)).toEqual(['current']); expect(rows[0]!.storageKey).not.toBe(first!.storageKey);
    expect(tombstones.has(key(f.memberId, first!.storageKey))).toBe(true);
    const bytes = Buffer.from(await readSharePhoto(f.memberId));
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    expect(stored.get(key(f.memberId, rows[0]!.storageKey))).not.toContain(bytes.toString('base64'));
  });
  it('a failed purge keeps the retired row, and Turn off purges it', async () => {
    const f = await fixture();
    mocks.purge.mockRejectedValueOnce(new Error('PRIVATE_STORAGE_SENTINEL'));
    await f.pick();
    expect((await f.photos()).map(row => row.status).sort()).toEqual(['current', 'retired']);
    await f.decide('deny');
    expect(await f.photos()).toEqual([]);
    await expect(readSharePhoto(f.memberId)).rejects.toMatchObject({ httpStatus: 404 });
  });
  it('a store failure retires and purges the request\'s own copy', async () => {
    const f = await fixture(), [first] = await f.photos();
    mocks.put.mockRejectedValueOnce(new Error('PRIVATE_STORAGE_SENTINEL'));
    await expect(f.pick()).rejects.toThrow();
    expect((await f.photos()).map(row => row.storageKey)).toEqual([first!.storageKey]);
    expect(mocks.purge).toHaveBeenCalledTimes(1);
  });
  it('a pick after Turn off is refused and stores nothing', async () => {
    const f = await fixture('pushups.reps', { photo: false });
    await f.decide('deny');
    await expect(f.pick()).rejects.toMatchObject({ httpStatus: 409, code: 'PROGRESS_SHARE_PHOTO_OFF' });
    expect(await f.photos()).toEqual([]); expect(mocks.put).not.toHaveBeenCalled();
  });
  it('a Turn off during the upload wins: the copy is purged and the pick fails', async () => {
    const f = await fixture('pushups.reps', { photo: false }), put = mocks.put.getMockImplementation()!;
    mocks.put.mockImplementationOnce(async request => { await put(request); await f.decide('deny'); });
    await expect(f.pick()).rejects.toMatchObject({ code: 'PROGRESS_SHARE_PHOTO_OFF' });
    expect(await f.photos()).toEqual([]); expect(stored.size).toBe(0);
  });
  it('another member\'s or a missing post is not a source', async () => {
    const f = await fixture('pushups.reps', { photo: false });
    await expect(putSharePhoto(f.memberId, { from: 'post', entryId: 'entry-not-mine' }, f.input.beforeMutationTx)).rejects.toMatchObject({ httpStatus: 404 });
    expect(mocks.readProfile).not.toHaveBeenCalled(); expect(await f.photos()).toEqual([]);
  });
});
