import type { GameRecapStory } from '@murphai/contracts/recap-show';
import type { readGameRecapMaterial } from './service';
import { validateGameRecap } from '@murphai/contracts/recap-validation';

/** Canonical facts only. Two authored pages plus the normal result page. */
export function buildRecapFallback(material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>): GameRecapStory {
  const [first, second] = material.validation.result;
  if (!first || !second) throw new Error('A fallback requires the settled pair result.');
  const score = `${Math.max(first.score, second.score)}–${Math.min(first.score, second.score)}`;
  const outcome = first.score === second.score ? `The game ended in a ${score} tie.` : `The game ended ${score}.`;
  const counts = material.players.map(name => ({ name, count: material.entries.filter(entry => entry.playerName === name && entry.visibleToBoth).length }));
  const story: GameRecapStory = { chatLine: outcome, pages: [
    { background: 'night', blocks: [{ kind: 'headline', text: 'The week, wrapped' }, { kind: 'kicker', text: 'THE FINAL SCORE' }] },
    { background: 'paper', blocks: counts.map(({ count }, index) => ({ kind: 'stat' as const, statValue: String(count), text: `${index === 0 ? 'First' : 'Second'} player's shared posts` })) },
  ] };
  // The presentation derives its third page from the canonical result. Include
  // that same fact here to validate the complete three-page plain fallback.
  const errors = validateGameRecap({ players: material.players, entries: material.entries, result: material.validation.result,
    recap: { ...story, pages: [...story.pages, { background: 'paper', blocks: [{ kind: 'stat', statValue: score, text: 'The final score' }] }] } });
  if (errors.length) throw new Error('Canonical recap fallback failed validation.');
  return story;
}
