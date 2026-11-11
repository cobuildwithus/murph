import type { GameRecapStory } from '@murphai/contracts/recap-show';

/** Pure canonical result, also readable after an interrupted first generation. */
export function buildRecapFallback(result: readonly { name: string; score: number }[]): GameRecapStory {
  const [first, second] = result;
  if (!first || !second) throw new Error('A fallback requires the settled pair result.');
  const score = `${Math.max(first.score, second.score)}–${Math.min(first.score, second.score)}`;
  const winner = first.score > second.score ? first : second;
  return {
    chatLine: first.score === second.score ? `The game ended in a ${score} tie.` : `${winner.name} won ${score}.`,
    pages: [
      { background: 'night', blocks: [{ kind: 'headline', text: 'The week, wrapped' }] },
      ...result.map(player => ({ background: 'paper' as const, blocks: [{ kind: 'stat' as const, statValue: String(player.score), text: player.name }] })),
    ],
  };
}
