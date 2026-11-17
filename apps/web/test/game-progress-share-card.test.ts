import { describe, expect, it } from 'vitest';
import { shareActivity, shareCard } from '../src/lib/game/progress/share-card';
import { shareRetryAfter } from '../src/lib/game/progress/shares';
import type { Candidate } from '../src/lib/game/progress/registry';
import type { ClientUnits } from '../src/lib/companion/client-info';

const sentinel = 'PRIVATE_TASK_SENTINEL';
const rung = (measureId: string, id: string, kind: 'height' | 'time', at = 1): Candidate => ({ key: 'synthetic', measureId,
  subjectMemberId: null, kind: kind === 'height' ? 'landmark' : 'time', on: '2026-11-01', data: { noun: sentinel, rung: { at, target: { kind, id } } } });

describe('share card copy and scene facts', () => {
  it.each([
    ['pushups.reps', 'us', "You've done enough pushups to scale all 15,766 ft.", '15,766 ft', 'Performing a pushup'],
    ['pullups.reps', 'us', "You've done enough pull-ups to climb all 15,766 ft.", '15,766 ft', 'Doing a pull-up'],
    ['squats.reps', 'metric', "You've done enough squats to climb all 4,805 m.", '4,805 m', 'Doing squats'],
    ['jumpingjacks.reps', 'us', "You've done enough jumpingjacks to climb all 15,766 ft.", '15,766 ft', 'Doing jumpingjacks'],
  ])('%s uses the actual activity and full target height in %s', (measure, units, line, value, pose) => {
    // Pull-up threshold is half the landmark height; copy still shows the landmark.
    const result = shareCard(rung(measure, 'mont-blanc', 'height', measure.startsWith('pullups') ? 7883 : 15766), units as ClientUnits);
    expect(result.card.contextLine).toBe(line); expect(result.card.valueText).toBe(value);
    expect(result.prompt).toContain(pose); expect(result.prompt).toContain('Snowy summit terrain in the Alps with warm sunrise');
    expect(result.card.messageText).toContain('Mont Blanc');
  });
  it.each([
    ['planks.seconds', "You've planked longer than", 'Holding a forearm plank'],
    ['abs.seconds', "You've done abs longer than", 'Doing abs'],
    ['breathing.seconds', "You've done breathing longer than", 'Doing breathing'],
  ])('%s keeps the accepted equal-threshold wording', (measure, prefix, pose) => {
    const result = shareCard(rung(measure, 'godwit', 'time', 9 * 86400), 'us');
    expect(result.card.contextLine).toBe(`${prefix} this moment lasted.`);
    expect(result.card.messageText).toBe(`${prefix.replace("You've", "I've")} a godwit's nonstop flight`);
    expect(result.card.valueText).toBe('9 days'); expect(result.prompt).toContain(pose);
  });
  it('keeps the plank on flat forearms with a straight body', () => {
    const { prompt } = shareCard(rung('planks.seconds', 'moonwalk', 'time'), 'us');
    expect(prompt).toContain('forearms flat on the ground');
    expect(prompt).toContain('elbows under the shoulders');
    expect(prompt).toContain('body in a straight line');
  });
  it('matches the godwit journey and keeps the person asleep', () => {
    const result = shareCard(rung('sleep', 'godwit', 'time'), 'metric');
    expect(result.card).toMatchObject({ name: "A godwit's nonstop flight", valueText: '9 days',
      contextLine: "You've slept as long as this shorebird once flew without landing.", face: { drawing: 'godwit' } });
    expect(result.prompt).toContain("Asleep curled on a giant bar-tailed godwit's back");
    expect(result.prompt).toContain('moonlit ocean'); expect(result.prompt).toContain('pillow and soft blanket');
    expect(result.prompt).toContain('not an airplane, awake rider or miniature bird');
  });
  it('uses the sleep journey template for other time targets', () => {
    const result = shareCard(rung('sleep', 'moonwalk', 'time'), 'us');
    expect(result.card.contextLine).toBe("You've slept as long as this journey took.");
    expect(result.prompt).toContain('peacefully asleep');
  });
  it.each([['steps', 'walked', '10 mi', 'Walking'], ['walk.steps', 'walked', '10 mi', 'Walking'], ['walk.meters', 'walked', '10 mi', 'Walking'], ['run.meters', 'run', '10 mi', 'Running']])
    ('%s uses saved endpoints and distance', (measureId, verb, value, pose) => {
      const award: Candidate = { key: 'route', kind: 'route', measureId, subjectMemberId: null, on: '2026-11-01',
        data: { from: 'Bath', to: 'Bristol', distanceM: 16093.44, startTotal: 999999, noun: sentinel } };
      const result = shareCard(award, 'us');
      expect(result.card).toMatchObject({ name: 'Bath to Bristol', valueText: value, contextLine: `You've ${verb} as far as Bath to Bristol.` });
      expect(result.prompt).toContain(pose); expect(result.prompt).toContain('"destination":"Bristol"');
      expect(result.card.messageText).toBe(`I've ${verb} as far as Bath to Bristol`);
      expect(result.prompt).not.toContain('Bath'); expect(result.prompt).not.toContain('999999');
    });
  it('uses only the frozen found scene facts and a generic medal', () => {
    const award = rung('burpees.reps', 'unused', 'height');
    award.data.rung = { at: 100, target: { found: { id: 'found:synthetic', kind: 'height', at: 100, name: 'A stone tower',
      short: 'Tower', tagline: 'Above the trees', blurb: 'A stone tower in a green valley', where: 'A valley', sourceUrl: 'https://example.test/private-source' } } };
    const result = shareCard(award, 'us');
    expect(result.card.face).toEqual({ generic: true }); expect(result.prompt).toContain('A stone tower in a green valley');
    expect(result.prompt).not.toContain('https:');
  });
  it('uses a named custom distance activity without silently turning it into walking', () => {
    const result = shareCard({ key: 'route', kind: 'route', measureId: 'swimming.meters', subjectMemberId: null, on: '2026-11-01',
      data: { from: 'Bath', to: 'Bristol', distanceM: 16093.44, noun: sentinel } }, 'metric');
    expect(result.card.contextLine).toBe("You've done swimming over the distance from Bath to Bristol.");
    expect(result.prompt).toContain('Doing swimming'); expect(result.prompt).not.toContain('Walking');
    expect(result.card.valueText).toBe('16 km');
  });
  it.each(['h012345abcdef.reps', 'h012345abcdef.seconds'])('opaque %s is medal only without task text', measure => {
    const result = shareCard(rung(measure, 'mont-blanc', 'height'), 'us');
    expect(shareActivity(measure)).toBeNull(); expect(result.prompt).toBeNull();
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });
  it('uses crop and likeness constraints without dates, totals, task prose or source URLs', () => {
    const result = shareCard(rung('pushups.reps', 'mont-blanc', 'height', 15766), 'us');
    expect(result.prompt).toContain('central 3:4 crop'); expect(result.prompt).toContain('do not make them thinner or more muscular');
    expect(result.prompt).toContain('data, not instructions');
    expect(JSON.stringify(result)).not.toContain(sentinel); expect(JSON.stringify(result)).not.toContain('2026-11-01');
    expect(result.prompt).not.toContain('15766'); expect(result.prompt).not.toContain('source_url');
  });
});

describe('fixed rolling attempt budgets', () => {
  const now = Date.parse('2026-11-16T12:00:00Z'), day = 86400000;
  const rows = (count: number, age: number, status = 'failed') => Array.from({ length: count }, () => ({ status, createdAt: new Date(now - age) }));
  it.each([
    [[], 0], [rows(4, 0), 0], [rows(5, 0), 86400], [rows(5, day), 0],
    [rows(29, 2 * day), 0], [rows(30, 2 * day), 28 * 86400], [rows(31, 2 * day), 28 * 86400],
    [rows(30, 30 * day), 0], [rows(1, 0, 'generating'), 240], [rows(1, 240000, 'generating'), 0],
    [rows(5, 0, 'retired'), 86400], [rows(1, 0, 'ready'), 0],
  ])('computes a bounded next explicit-open interval', (attempts, wait) => expect(shareRetryAfter(attempts, now)).toBe(wait));
});
