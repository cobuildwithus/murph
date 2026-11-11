import { expect, it } from 'vitest';
import { createHostedRecapFixture } from './helpers/recap-show-fixture.js';

it('loads the exported recap testkit and its synthetic media from the Cloudflare consumer', async () => {
  const fixture = await createHostedRecapFixture('synthetic-testkit-game');
  expect(fixture.material.game).toEqual({ id: 'synthetic-testkit-game', maxPlayers: 2, recapShow: true });
  expect(fixture.material.references.map(reference => reference.kind)).toEqual(['profile', 'profile', 'entry']);
  expect(() => fixture.accept()).toThrow('Selected upload is missing.');
  expect(fixture.saved).toEqual([]);
  expect(fixture.providerCalls).toEqual([]);
});

it.each(['unknown', 'changed'])('rejects %s reference bytes before synthetic provider admission', async mismatch => {
  const gameId = 'synthetic-testkit-game';
  const fixture = await createHostedRecapFixture(gameId);
  await expect(fixture.control({
    action: 'read_game', origin: { kind: 'game_recap', gameId, eventId: 'synthetic-event' },
    recapRead: {
      kind: 'reserve', runId: '00000000-0000-4000-8000-000000000001', operationId: 'cover',
      referenceIds: [mismatch === 'unknown' ? 'a'.repeat(64) : fixture.material.references[0]!.id],
      providerRequest: {
        kind: 'image', model: 'gpt-image-2.6-flare', requestHash: 'b'.repeat(64), promptBytes: 16,
        size: '1024x1536', quality: 'high', outputFormat: 'jpeg', referenceHashes: ['c'.repeat(64)],
      },
    },
  })).rejects.toThrow('Unapproved synthetic photo.');
  expect(fixture.providerCalls).toEqual([]);
});
