import { GET as getRecapAsset } from "../app/api/game/v1/games/[id]/recap-assets/[slot]/route";
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectGeneratedMp3Audio, inspectMp3Frames } from '@murphai/operator-config/generated-audio';
import { hostedRecapMediaObjectKey } from '@murphai/hosted-execution/storage-paths';
import { gameRecapEnvelopeSchema, presentGameRecap } from '@murphai/contracts/recap-show';

vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMember: async () => "synthetic-viewer" }));
const state = vi.hoisted(() => ({ envelope: '', allowed: true, revoked: false }));
vi.mock('@/src/lib/game/service', () => ({ readGame: async () => state.allowed ? { recap: { show: {} } } : null }));
vi.mock('@/src/lib/game/access', () => ({ isRecapMediaVisible: () => true }));
vi.mock('@/src/lib/game/crypto', () => ({
  sealGameMedia: async ({ bytes }: { bytes: Uint8Array }) => Buffer.from(bytes).toString('base64'),
  openGameMedia: async ({ envelope }: { envelope: string }) => Buffer.from(envelope, 'base64'),
  openGameTexts: async () => [state.envelope],
}));
vi.mock('@/src/lib/prisma', () => ({ getPrisma: () => ({
  game: { findUnique: async () => ({ id: 'synthetic-game', status: 'settled', maxPlayers: 2, wordsOwnerMemberId: 'synthetic-owner', recapEncrypted: 'synthetic', players: [{ memberId: 'a', leftAt: null }, { memberId: 'b', leftAt: null }] }) },
  hostedConsentGrant: { count: async () => Number(state.revoked) }, gameBlock: { findFirst: async () => null }, gameReport: { count: async () => 0 },
  gameProfile: { findMany: async () => [] }, gameEntry: { findMany: async () => [] },
}) }));
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); state.allowed = true; state.revoked = false; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('validates, stores once and serves authorized full and sliced views after full-file integrity, with matching lyric clocks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-score-')); roots.push(root);
  vi.stubEnv('MURPH_GAME_RECAP_MEDIA_DIR', root); vi.stubEnv('VERCEL_ENV', 'test');
  const { putRecapMedia } = await import('@/src/lib/game/recap-media');
  const { readAuthorizedRecapAsset } = await import('@/src/lib/game/recap-asset-access');
  const fixture = await readFile(new URL('../../../fixtures/generated-audio/recap-synthetic-20s.mp3', import.meta.url));
  const stream = inspectMp3Frames(fixture);
  const frames = stream.frames.slice(1).map((f, i) => fixture.subarray(f.byteOffset, stream.frames[i + 2]?.byteOffset ?? stream.endOffset));
  const bytes = Buffer.concat(Array.from({ length: Math.round(25_000 / stream.frames[1]!.timeMs) }, (_, i) => frames[i % frames.length]!));
  const cut = [...inspectMp3Frames(bytes).frames].reverse().find(f => f.timeMs <= 4800)!;
  const hash = createHash('sha256').update(bytes).digest('hex'), generationId = 'a'.repeat(32);
  const storageKey = `recap/${generationId}/${hash}.mp3`, ownerMemberId = 'synthetic-owner';
  const wordsTimestamps = [{ word: 'Hello', startMs: 5000, endMs: 5300 }];
  const metadata = await putRecapMedia({ storageKey, ownerMemberId, bytes, songStartMs: cut.timeMs, wordsTimestamps });
  const envelope = gameRecapEnvelopeSchema.parse({ version: 1, generationId, acceptedAt: '2026-11-14T00:00:00Z',
    story: { chatLine: 'Synthetic show.', pages: [{ background: 'paper', blocks: [{ kind: 'headline', text: 'Hello' }] }], song: { title: 'Hello', style: 'Piano', lyrics: ['Hello'] } },
    assets: [{ slot: 'song', kind: 'song', recipeId: hash, storageKey, hash, references: [], byteLength: bytes.length, mediaType: 'audio/mpeg', durationMs: metadata.durationMs, songStartMs: cut.timeMs, wordsTimestamps }],
    preview: { token: 'synthetic-preview-token-with-no-authority', expiresAt: '2026-12-14T00:00:00Z' } });
  state.envelope = JSON.stringify(envelope);
  const input = { gameId: 'synthetic-game', generationId, memberId: 'a', slot: 'score' };
  const full = (await readAuthorizedRecapAsset(input))!, song = (await readAuthorizedRecapAsset({ ...input, slot: 'song' }))!;
  expect(Buffer.from(full.bytes).equals(bytes)).toBe(true);
  expect(Buffer.from(song.bytes).equals(bytes.subarray(cut.byteOffset))).toBe(true);
  expect((await inspectGeneratedMp3Audio(song.bytes)).durationMs).toBeCloseTo(metadata.durationMs! - cut.timeMs, -2);
  const view = presentGameRecap({ stored: envelope, permittedPhotoIds: new Set(), mediaUrl: slot => `/synthetic/${slot}` });
  expect(view.show!.pages[1]!.cueMs).toBe(5000);
  expect(view.show!.pages[1]!.song!.lines![0]!.words[0]!.startMs).toBe(Math.round(5000 - cut.timeMs));
  for (const slot of ['song', 'score']) {
    expect(await readAuthorizedRecapAsset({ ...input, slot, generationId: 'stale' })).toBeNull();
    state.allowed = false; expect(await readAuthorizedRecapAsset({ ...input, slot })).toBeNull(); state.allowed = true;
    state.revoked = true; expect(await readAuthorizedRecapAsset({ ...input, slot })).toBeNull(); state.revoked = false;
  }
  const requestAsset = () => getRecapAsset(new Request(`https://example.test/recap?generation=${generationId}`), {
    params: Promise.resolve({ id: input.gameId, slot: "song" }),
  });
  state.allowed = false;
  const refused = await requestAsset();
  expect(refused.status).toBe(404);
  expect(await refused.json()).toMatchObject({ error: { code: "GAME_NOT_FOUND" } });
  state.allowed = true;
  for (const corruptEnvelope of [
    {},
    { ...envelope, assets: [{ ...envelope.assets[0], hash: "b".repeat(64) }] },
    { ...envelope, assets: [{ ...envelope.assets[0], songStartMs: cut.timeMs + 1 }] },
  ]) {
    state.envelope = JSON.stringify(corruptEnvelope);
    const response = await requestAsset();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  }
  // A failed generation stores a bare fallback story on purpose: it has no media.
  state.envelope = JSON.stringify(envelope.story);
  expect((await requestAsset()).status).toBe(404);
  state.envelope = JSON.stringify(envelope);
  // A modification before C must still invalidate the legacy slice.
  const file = path.join(root, hostedRecapMediaObjectKey({ userId: ownerMemberId, mediaId: storageKey }));
  const stored = JSON.parse(await readFile(file, 'utf8'));
  const corrupt = Buffer.from(stored.envelope, 'base64'); corrupt[10] ^= 1; stored.envelope = corrupt.toString('base64');
  await writeFile(file, JSON.stringify(stored));
  for (const slot of ['score', 'song']) await expect(readAuthorizedRecapAsset({ ...input, slot })).rejects.toThrow('integrity');
});
