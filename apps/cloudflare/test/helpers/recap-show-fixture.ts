import { expect } from 'vitest';
import type { GameRecapStory, RecapFileReceipt } from '@murphai/contracts/recap-show';
import { gameRecapToolResult, validateGameRecap } from '@murphai/contracts/recap-validation';
import type { HostedGameToolResponse, HostedRuntimeGroupToolRequest } from '@murphai/hosted-execution/runtime-control';
// Reuse the sanctioned live lane's synthetic media and real reservation/byte checks.
import { createRecapShowLiveProviders } from '@murphai/assistant-engine/recap-show-testkit';

export async function createHostedRecapFixture(gameId: string, mediaFails = false) {
  const players = [{ memberId: 'synthetic-a', name: 'Player A' }, { memberId: 'synthetic-b', name: 'Player B' }];
  const entries = [{ entryId: 'synthetic-photo-a', playerName: 'Player A', kind: 'photo', text: 'Purple mat', visibleToBoth: true }];
  const result = players.map((player, index) => ({ ...player, score: 3 - index }));
  const chat = [{ playerName: 'Player B', text: 'The laundry basket supervises.' }];
  const providers = await createRecapShowLiveProviders({ game: { id: gameId, maxPlayers: 2, recapShow: true }, players, entries, result, chat, ...(mediaFails ? { mediaFetch: async () => Response.json({ error: { message: 'Synthetic provider unavailable' } }, { status: 503 }) } : {}) });
  const receipts: RecapFileReceipt[] = [];
  const saved: GameRecapStory[] = [];
  const phases: string[] = [];
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
  expect(validateGameRecap({ recap: story, players: players.map(player => player.name), entries, result, chatMessages: chat, show: true })).toEqual([]);
  const control = async (request: HostedRuntimeGroupToolRequest): Promise<HostedGameToolResponse> => {
    if (request.action === 'read_game') {
      const response = await providers.control(request);
      if (request.recapRead?.kind === 'finished' && request.recapRead.receipt) receipts.push(request.recapRead.receipt);
      return response;
    }
    if (request.action !== 'write_recap') throw new Error('Unexpected synthetic action.');
    const errors = validateGameRecap({ recap: request.recap, players: players.map(player => player.name), entries, result, chatMessages: chat, show: true });
    if (errors.length) return { action: 'write_recap', result: { status: 'rejected', recapOutcome: gameRecapToolResult(errors) } };
    phases.push(request.phase ?? 'missing');
    if (request.phase === 'prepare') return { action: 'write_recap', result: { status: 'ok', recapGame: providers.prepare({ story: request.recap, files: request.files }) } };
    providers.accept();
    saved.push(request.recap);
    return { action: 'write_recap', result: { status: 'ok', recap: request.recap, recapOutcome: gameRecapToolResult([]), chatLine: `${request.recap.chatLine}\nWatch the recap: https://recaps.murph.test/recap/${gameId}` } };
  };
  return { ...providers, control, story, receipts, saved, phases };
}
