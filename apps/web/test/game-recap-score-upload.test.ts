import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectMp3Frames } from '@murphai/operator-config/generated-audio';
import { hostedGameToolRequestSchema } from '@murphai/hosted-execution/runtime-control';
import { recapAssetSchema } from '@murphai/contracts/recap-show';
import { uploadRecapMedia } from '@/src/lib/game/recap-media';

vi.mock('@/src/lib/game/crypto', () => ({ sealGameMedia: async () => 'synthetic-sealed-media' }));
vi.mock('@/src/lib/game/recap-inputs', () => ({ readRecapSourceReferences: async () => [] }));
vi.mock('@/src/lib/game/chat-membership', () => ({ readGameChatAudience: async () => ({}), readGameChatAuthority: async () => true }));
vi.mock('@/src/lib/game/recap-witness', () => ({ readGameRecapEntryIdsTx: async () => [], readLatestGameRecapEventIdTx: async () => 'synthetic-event' }));
vi.mock('@/src/lib/game/recap-asset-access', () => ({ recapReferencesCurrent: async () => true }));
vi.mock('@/src/lib/game/recap-retirement', () => ({ registerRecapAssetsTx: async () => {} }));
vi.mock('@/src/lib/prisma', () => {
  const db = { game: { findUnique: async () => ({ id: 'synthetic-game', status: 'settled', maxPlayers: 2, wordsOwnerMemberId: 'synthetic-owner' }) },
    $queryRaw: async () => [], $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db) };
  return { getPrisma: () => db };
});
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it.each([false, true])('returns the actual strict upload receipt for a score=%s, keeping the old wire shape', async score => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-upload-')); roots.push(root);
  vi.stubEnv('MURPH_GAME_RECAP_MEDIA_DIR', root); vi.stubEnv('VERCEL_ENV', 'test');
  const fixture = await readFile(new URL('../../../fixtures/generated-audio/recap-synthetic-20s.mp3', import.meta.url));
  const stream = inspectMp3Frames(fixture);
  const frames = stream.frames.slice(1).map((frame, i) => fixture.subarray(frame.byteOffset, stream.frames[i + 2]?.byteOffset ?? stream.endOffset));
  const bytes = score ? Buffer.concat(Array.from({ length: Math.round(25_000 / stream.frames[1]!.timeMs) }, (_, i) => frames[i % frames.length]!)) : fixture;
  const first = score ? 5000 : 100;
  const request = hostedGameToolRequestSchema.parse({ action: 'read_game', origin: { kind: 'game_recap', gameId: 'synthetic-game', eventId: 'synthetic-event' },
    recapRead: { kind: 'upload', slot: 'song', mediaType: 'audio/mpeg', bytes: bytes.toString('base64'), referenceIds: [],
      wordsTimestamps: [{ word: 'Hello', startMs: first, endMs: first + 300 }], ...(score ? { songStartMs: 4800 } : {}) } });
  if (request.action !== 'read_game' || request.recapRead?.kind !== 'upload') throw new Error('Expected upload');
  const beforeMutationTx = vi.fn(async () => {});
  const receipt = await uploadRecapMedia({ gameId: 'synthetic-game', eventId: 'synthetic-event', memberId: 'synthetic-room', beforeMutationTx,
    material: { game: {}, players: [], entries: [], validation: { show: true, startedAt: new Date(0), settledAt: new Date(1), playerNamesByMemberId: [], result: [] } }, file: { ...request.recapRead, mediaType: 'audio/mpeg' } });
  expect(beforeMutationTx).toHaveBeenCalledOnce();
  expect(recapAssetSchema.parse(receipt)).toEqual(receipt);
  expect(receipt.durationMs).toBeGreaterThan(score ? 24_500 : 19_500);
  expect(receipt.durationMs).toBeLessThan(score ? 25_500 : 20_500);
  expect(Object.keys(receipt).sort()).toEqual(['slot', 'kind', 'recipeId', 'storageKey', 'references', 'hash', 'mediaType', 'byteLength', 'durationMs', 'wordsTimestamps', ...(score ? ['songStartMs'] : [])].sort());
  if (score) expect(receipt.songStartMs).toBe(4800);
  else expect(receipt).not.toHaveProperty('songStartMs');
});
