import { expect, it } from 'vitest';
import { createHostedRecapFixture } from './helpers/recap-show-fixture.js';

it('loads the exported recap testkit and its synthetic media from the Cloudflare consumer', async () => {
  const fixture = await createHostedRecapFixture('synthetic-testkit-game');
  expect(fixture.material.game).toEqual({ id: 'synthetic-testkit-game', maxPlayers: 2, recapShow: true });
  expect(fixture.material.references.map(reference => reference.kind)).toEqual(['profile', 'profile', 'entry']);
  expect(fixture.saved).toEqual([]);
  expect(fixture.providerCalls).toEqual([]);
});
