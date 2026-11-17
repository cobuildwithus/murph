import type { GameRecapStory } from '@murphai/contracts/recap-show';

type PairResult = readonly { name: string; score: number }[];

/** A settled pair result in one sentence. */
function pairResultSentence(result: PairResult, earnedBothWinPrize?: string): string {
  const [first, second] = result;
  if (!first || !second) throw new Error('A fallback requires the settled pair result.');
  const score = `${Math.max(first.score, second.score)}–${Math.min(first.score, second.score)}`;
  const winner = first.score > second.score ? first : second;
  return earnedBothWinPrize ? `Both of you did every day. You both get ${earnedBothWinPrize}.` : first.score === second.score ? `The game ended in a ${score} tie.` : `${winner.name} won ${score}.`;
}

/** Pure canonical result, also readable after an interrupted first generation. */
export function buildRecapFallback(result: PairResult, earnedBothWinPrize?: string): GameRecapStory {
  return {
    chatLine: pairResultSentence(result, earnedBothWinPrize),
    pages: [
      { background: 'night', blocks: [{ kind: 'headline', text: 'The week, wrapped' }] },
      ...result.map(player => ({ background: 'paper' as const, blocks: [{ kind: 'stat' as const, statValue: String(player.score), text: player.name }] })),
    ],
  };
}

/**
 * What the chat is told when a player's day correction changes a finished
 * game's outcome. A recap already made keeps the result it was written from.
 */
export function gameResultCorrectionLine(input: { name: string; date: string; counts: boolean; result: PairResult; earnedBothWinPrize?: string; recapMade: boolean }): string {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${input.date}T12:00:00Z`));
  return [`${input.name}'s check-in for ${day} ${input.counts ? 'now counts' : 'no longer counts'}.`, 'That changes the result.',
    pairResultSentence(input.result, input.earnedBothWinPrize), ...(input.recapMade ? ['The recap was made before this change.'] : [])].join(' ');
}
