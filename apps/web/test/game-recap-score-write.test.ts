import { expect, it } from 'vitest';
import { recapShowWriteError } from '@/src/lib/game/chat-tool';
import type { HostedGameToolRequest } from '@murphai/hosted-execution/runtime-control';

const request: Extract<HostedGameToolRequest, { action: 'write_recap' }> = {
  action: 'write_recap', origin: { kind: 'game_recap', gameId: 'synthetic-game', eventId: 'synthetic-event' },
  recap: { chatLine: 'Synthetic.', pages: [{ background: 'paper', blocks: [{ kind: 'headline', text: 'Hello' }] }],
    song: { title: 'Hello', style: 'Piano', lyrics: ['Hello friend'] } },
  assets: [{ slot: 'song', kind: 'song', recipeId: 'synthetic', storageKey: 'synthetic', hash: 'a'.repeat(64), references: [],
    byteLength: 400000, mediaType: 'audio/mpeg', durationMs: 25_000, songStartMs: 4800,
    wordsTimestamps: [{ word: 'Hello', startMs: 5000, endMs: 5200 }, { word: 'friend', startMs: 5300, endMs: 5500 }] }],
};
it('refuses stale score page counts and unusable rebased lyrics, while retaining legacy songs', () => {
  expect(recapShowWriteError(request, { entries: [] }, [])).toBeNull();
  const extraPage = { ...request, recap: { ...request.recap, pages: [...request.recap.pages, ...request.recap.pages] } };
  expect(recapShowWriteError(extraPage, { entries: [] }, [])).toContain('The song was made for different pages');
  const extraCard = { ...request, recap: { ...request.recap, superlatives: [{ memberId: 'a', title: 'Hold the line', line: 'Hello' }] } };
  expect(recapShowWriteError(extraCard, { entries: [] }, ['a'])).toContain('The song was made for different pages');
  expect(recapShowWriteError({ ...request, assets: [{ ...request.assets![0]!, durationMs: 30_000 }] }, { entries: [] }, []))
    .toContain('The song was made for different pages');
  const { songStartMs: _cut, ...legacy } = request.assets![0]!;
  expect(recapShowWriteError({ ...request, assets: [{ ...legacy, durationMs: 20_000 }] }, { entries: [] }, [])).toBeNull();
  const bad = { ...request, assets: [{ ...request.assets![0]!, wordsTimestamps: [{ word: 'Hello', startMs: 0, endMs: 0 }] }] };
  expect(recapShowWriteError(bad, { entries: [] }, [])).toContain('Song timings');
});
