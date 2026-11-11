import type { GameRecapStory } from '@murphai/contracts/recap-show';
// Synthetic transport shared with the live lane.
import { createRecapShowLiveProviders } from '@murphai/assistant-engine/recap-show-testkit';

export async function createHostedRecapFixture(gameId: string, mediaFails = false) {
  const players = [{ memberId: 'synthetic-a', name: 'Player A' }, { memberId: 'synthetic-b', name: 'Player B' }];
  const entries = [{ entryId: 'synthetic-photo-a', playerName: 'Player A', kind: 'photo', text: 'Purple mat', visibleToBoth: true }];
  const result = players.map((player, index) => ({ ...player, score: 3 - index }));
  const chat = [{ playerName: 'Player B', text: 'The laundry basket supervises.' }];
  const providers = await createRecapShowLiveProviders({ game: { id: gameId, maxPlayers: 2, recapShow: true }, players, entries, result, chat, ...(mediaFails ? { mediaFetch: async () => Response.json({ error: { message: 'Synthetic provider unavailable' } }, { status: 503 }) } : {}) });
  const story: GameRecapStory = {
    treatment: 'Laundry space opera',
    chatLine: 'Player A won 3–2. The laundry basket supervised the entire mission.',
    song: { title: 'Laundry orbit', style: 'Warm acoustic pop.', lyrics: ['Purple mat on the floor', 'Laundry waits by the door', 'Three to two in the light', 'Mission done for the night'] },
    pages: [
      { background: 'night', blocks: [
        { kind: 'headline', text: 'Laundry orbit' },
        { kind: 'scene', scene: { cast: ['Player A', 'Player B'], prompt: 'Two synthetic astronauts stand beside a giant laundry basket on a quiet purple moon, with a small exercise mat floating behind them and warm cinematic lighting.' } },
        { kind: 'kicker', text: 'Breakfast in bed' },
      ] },
      { background: 'paper', blocks: [
        { kind: 'headline', text: 'The purple launch pad' },
        { kind: 'photo', style: 'print', entryIds: ['synthetic-photo-a'] },
        { kind: 'headline', text: 'Player A reported for duty' },
      ] },
      { background: 'sage', blocks: [{ kind: 'quote', quote: { who: 'Player B', text: chat[0]!.text } }] },
      { background: 'slate', blocks: [{ kind: 'headline', text: 'Mission control counted every landing' }] },
      { background: 'sienna', blocks: [
        { kind: 'headline', text: 'One last orbit' },
        { kind: 'scene', scene: { cast: ['Player B'], prompt: 'A synthetic astronaut carefully folds a small towel beside a gigantic laundry basket under a purple sky, framed as a cinematic wide shot with soft warm light.' } },
        { kind: 'headline', text: 'Laundry remains undefeated' },
      ] },
    ],
  };
  return { ...providers, story };
}
