import { describe, expect, it } from 'vitest';
import { shareActivity, shareCard, stampAmount } from '../src/lib/game/progress/share-card';
import { EXERCISES } from '../src/lib/game/progress/registry';
import { shareViewSchema } from '../src/lib/game/progress/contract';
import { SHARE_ZONES } from '../src/lib/game/progress/share-card';
import { shareAvailableAt } from '../src/lib/game/progress/shares';
import type { Candidate } from '../src/lib/game/progress/registry';
import type { ClientUnits } from '../src/lib/companion/client-info';
import { BANK } from '../src/lib/game/progress/bank';
import { medalView } from '../src/lib/game/progress/view';

const sentinel = 'PRIVATE_TASK_SENTINEL';
const rung = (measureId: string, id: string, kind: 'height' | 'time', at = BANK.find(entry => entry.id === id)!.at,
  noun = shareActivity(measureId) ?? sentinel): Candidate => ({ key: 'synthetic', measureId,
  subjectMemberId: null, kind: kind === 'height' ? 'landmark' : 'time', on: '2026-11-01', data: { noun, rung: { at, target: { kind, id } } } });

describe('share card copy and scene facts', () => {
  it.each([
    { award: rung('pushups.reps', 'mont-blanc', 'height'), name: 'Mont Blanc', valueText: '15,766 pushups',
      contextLine: 'You’ve done enough pushups to scale all 15,766 ft.' },
    { award: { key: 'route', kind: 'route', measureId: 'walk.meters', subjectMemberId: null, on: '2026-11-01',
      data: { from: 'London', to: 'Brighton', distanceM: 54 * 1609.344 } } satisfies Candidate,
      name: 'London to Brighton', valueText: '54 miles', contextLine: 'You’ve walked as far as London to Brighton.' },
    { award: rung('sleep', 'godwit', 'time', 264 * 3600), name: 'A godwit’s nonstop flight', valueText: '264 hours asleep',
      contextLine: 'You’ve slept as long as this shorebird once flew without landing.' },
    { award: rung('planks.seconds', 'moonwalk', 'time'), name: 'The first moonwalk', valueText: '151 minutes planked',
      contextLine: 'You’ve planked longer than this moment lasted.' },
  ])('matches the approved $name card', ({ award, ...card }) => {
    expect(shareCard(award, 'us').card).toMatchObject(card);
  });
  it.each([
    rung('pushups.reps', 'mont-blanc', 'height'),
    rung('planks.seconds', 'moonwalk', 'time'),
    rung('sleep', 'godwit', 'time'),
    { key: 'route', kind: 'route', measureId: 'walk.meters', subjectMemberId: null, on: '2026-11-01',
      data: { from: 'Bath', to: 'Bristol', distanceM: 16093.44 } } satisfies Candidate,
  ])('adds rounded height and weight only to $measureId prompt framing', award => {
    const original = shareCard(award, 'us');
    expect(shareCard(award, 'us', { heightCm: null, weightKg: null })).toEqual(original);
    expect(original.prompt).not.toMatch(/ tall| weighs/u);
    for (const [body, line] of [
      [{ heightCm: 170.4, weightKg: null }, 'The person is 5 ft 7 in (170 cm) tall. Make their body match this height.'],
      [{ heightCm: 167.6, weightKg: 81.6 }, 'The person is 5 ft 6 in (168 cm) tall and weighs 180 lb (82 kg). Make their body match this height and weight.'],
      [{ heightCm: null, weightKg: 63.4 }, 'The person weighs 140 lb (63 kg). Make their body match this weight.'],
      [{ heightCm: 182.9, weightKg: 99.8 }, 'The person is 6 ft 0 in (183 cm) tall and weighs 220 lb (100 kg). Make their body match this height and weight.'],
    ] as const) {
      const result = shareCard(award, 'us', body);
      expect(result.prompt!.split('\n')[1]).toBe(line);
      expect(result.prompt!.replace(`${line}\n`, '')).toBe(original.prompt);
      expect(result.card).toEqual(original.card);
      expect(JSON.stringify(result.card)).not.toMatch(/tall|weigh/u);
    }
  });
  it.each([
    ['pushups.reps', 'us', 'You’ve done enough pushups to scale all 15,766 ft.', '15,766 pushups', 'Performing a pushup'],
    ['pullups.reps', 'us', 'You’ve done enough pull-ups to climb all 15,766 ft.', '7,883 pull-ups', 'Doing a pull-up'],
    ['squats.reps', 'metric', 'You’ve done enough squats to climb all 4,805 m.', '15,766 squats', 'Doing squats'],
    ['jumpingjacks.reps', 'us', 'You’ve done enough jumpingjacks to climb all 15,766 ft.', '15,766 jumpingjacks', 'Doing jumpingjacks'],
  ])('%s uses the actual activity and full target height in %s', (measure, units, line, value, pose) => {
    // The big number is the exercise count; context still describes the landmark height.
    const result = shareCard(rung(measure, 'mont-blanc', 'height', measure.startsWith('pullups') ? 7883 : 15766), units as ClientUnits);
    expect(result.card.contextLine).toBe(line); expect(result.card.valueText).toBe(value);
    expect(result.prompt).toContain(pose); expect(result.prompt).toContain('Snowy summit terrain in the Alps with warm sunrise');
    expect(result.card.messageText).toContain('Mont Blanc');
  });
  it.each([
    ['planks.seconds', 'You’ve planked longer than', 'Holding a forearm plank', '216 hours planked'],
    ['abs.seconds', 'You’ve done abs longer than', 'Doing abs', '216 hours of abs'],
    ['breathing.seconds', 'You’ve done breathing longer than', 'Doing breathing', '216 hours of breathing'],
  ])('%s keeps the accepted equal-threshold wording', (measure, prefix, pose, valueText) => {
    const result = shareCard(rung(measure, 'godwit', 'time', 9 * 86400), 'us');
    expect(result.card.contextLine).toBe(`${prefix} this moment lasted.`);
    expect(result.card.messageText).toBe(`${prefix.replace('You’ve', 'I’ve')} a godwit’s nonstop flight`);
    expect(result.card.valueText).toBe(valueText); expect(result.prompt).toContain(pose);
  });
  it.each([
    ['planks.seconds', 35999, '599 minutes planked'], ['planks.seconds', 36000, '10 hours planked'],
    ['planks.seconds', 39659, '11 hours planked'], ['abs.seconds', 9100, '151 minutes of abs'],
    ['abs.seconds', 36000, '10 hours of abs'], ['abs.seconds', 3600 * 10001, '10,001 hours of abs'],
    ['sleep', 264 * 3600 + 59, '264 hours asleep'], ['sleep', 9 * 86400, '216 hours asleep'],
  ])('%s formats saved duration %i in whole minutes or hours', (measure, at, value) => {
    expect(shareCard(rung(measure, 'moonwalk', 'time', at), 'us').card.valueText).toBe(value);
  });
  it('rounds the earned count up and uses its saved noun', () => {
    const award = rung('jumpingjacks.reps', 'mont-blanc', 'height', 10000.2, "jumper's reps");
    expect(shareCard(award, 'metric').card.valueText).toBe('10,001 jumper’s reps');
  });
  it.each([
    ['planks.seconds', 'moonwalk', 'time', 'moonwalk'], ['sleep', 'godwit', 'time', 'godwit'],
    ['pushups.reps', 'mont-blanc', 'height', 'mont-blanc'],
  ] as const)('%s shares the medal drawing', (measure, id, kind, drawing) => {
    const award = rung(measure, id, kind);
    const medal = medalView({ ...award, id: 'synthetic', createdAt: new Date('2026-11-01'), seenAt: null }, false, 'us');
    expect(shareCard(award, 'us').card.face).toEqual(medal.face);
    expect(medal.face).toEqual({ drawing });
  });
  it('keeps the plank on flat forearms with a straight body', () => {
    const { prompt } = shareCard(rung('planks.seconds', 'moonwalk', 'time'), 'us');
    expect(prompt).toContain('forearms flat on the ground');
    expect(prompt).toContain('elbows under the shoulders');
    expect(prompt).toContain('body in a straight line');
  });
  it('matches the godwit journey and keeps the person asleep', () => {
    const result = shareCard(rung('sleep', 'godwit', 'time'), 'metric');
    expect(result.card).toMatchObject({ name: 'A godwit’s nonstop flight', valueText: '216 hours asleep',
      contextLine: 'You’ve slept as long as this shorebird once flew without landing.', face: { drawing: 'godwit' } });
    expect(result.prompt).toContain("Asleep curled on a giant bar-tailed godwit's back");
    expect(result.prompt).toContain('moonlit ocean'); expect(result.prompt).toContain('pillow and soft blanket');
    expect(result.prompt).toContain('not an airplane, awake rider or miniature bird');
  });
  it('uses the sleep journey template for other time targets', () => {
    const result = shareCard(rung('sleep', 'moonwalk', 'time'), 'us');
    expect(result.card.contextLine).toBe('You’ve slept as long as this journey took.');
    expect(result.prompt).toContain('peacefully asleep');
  });
  it.each([['steps', 'walked', '10 miles', 'Walking'], ['walk.steps', 'walked', '10 miles', 'Walking'], ['walk.meters', 'walked', '10 miles', 'Walking'], ['run.meters', 'run', '10 miles', 'Running']])
    ('%s uses saved endpoints and distance', (measureId, verb, value, pose) => {
      const award: Candidate = { key: 'route', kind: 'route', measureId, subjectMemberId: null, on: '2026-11-01',
        data: { from: 'Bath', to: 'Bristol', distanceM: 16093.44, startTotal: 999999, noun: sentinel } };
      const result = shareCard(award, 'us');
      expect(result.card).toMatchObject({ name: 'Bath to Bristol', valueText: value, contextLine: `You’ve ${verb} as far as Bath to Bristol.` });
      expect(result.prompt).toContain(pose); expect(result.prompt).toContain('"destination":"Bristol"');
      expect(result.card.messageText).toBe(`I’ve ${verb} as far as Bath to Bristol`);
      expect(result.prompt).not.toContain('Bath'); expect(result.prompt).not.toContain('999999');
    });
  it('uses only the frozen found scene facts and a generic medal', () => {
    const award = rung('burpees.reps', 'unused', 'height', 100);
    award.data.rung = { at: 100, target: { found: { id: 'found:synthetic', kind: 'height', at: 100, name: 'A stone tower',
      short: 'Tower', tagline: 'Above the trees', blurb: 'A stone tower in a green valley', where: 'A valley', sourceUrl: 'https://example.test/private-source' } } };
    const result = shareCard(award, 'us');
    expect(result.card.face).toEqual({ generic: true }); expect(result.prompt).toContain('A stone tower in a green valley');
    expect(result.prompt).not.toContain('https:');
  });
  it('uses a named custom distance activity without silently turning it into walking', () => {
    const result = shareCard({ key: 'route', kind: 'route', measureId: 'swimming.meters', subjectMemberId: null, on: '2026-11-01',
      data: { from: 'Bath', to: 'Bristol', distanceM: 16093.44, noun: sentinel } }, 'metric');
    expect(result.card.contextLine).toBe('You’ve done swimming over the distance from Bath to Bristol.');
    expect(result.prompt).toContain('Doing swimming'); expect(result.prompt).not.toContain('Walking');
    expect(result.card.valueText).toBe('16 km');
  });
  it.each([
    ['h012345abcdef.reps', 'mont-blanc', 'height', '15,766 repetitions'],
    ['h012345abcdef.seconds', 'moonwalk', 'time', '2 hr 31 min'],
  ] as const)('opaque %s stays medal only with its plain amount', (measure, id, kind, value) => {
    const result = shareCard(rung(measure, id, kind, undefined, 'repetitions'), 'us');
    expect(shareActivity(measure)).toBeNull(); expect(result.prompt).toBeNull();
    expect(result.card.valueText).toBe(value);
    expect(result.card.contextLine).toBe('A new milestone in your progress.');
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });
  it.each(['us', 'metric'] as const)('normalizes route text once and uses plain distance in %s', units => {
    const { card } = shareCard({ key: 'route', kind: 'route', measureId: 'walk.meters', subjectMemberId: null,
      on: '2026-11-01', data: { from: "St John's", to: "King's Lynn", distanceM: 54 * 1609.344 } }, units);
    expect(card).toMatchObject({ name: 'St John’s to King’s Lynn', valueText: units === 'us' ? '54 miles' : '87 km',
      contextLine: 'You’ve walked as far as St John’s to King’s Lynn.', messageText: 'I’ve walked as far as St John’s to King’s Lynn' });
    for (const text of [card.name, card.valueText, card.contextLine, card.messageText]) expect(text).not.toContain("'");
  });
  it('uses crop and likeness constraints without dates, totals, task prose or source URLs', () => {
    const result = shareCard(rung('pushups.reps', 'mont-blanc', 'height', 15766, sentinel), 'us');
    expect(result.prompt).not.toContain('3:4'); expect(result.prompt).not.toContain('quiet space');
    expect(result.prompt).toContain('Top band, y 0 to 0.30, full width: open sky or plain background only.');
    expect(result.prompt).toContain('between y 0.32 and 0.92'); expect(result.prompt).toContain('x 0.75 to 1 and y 0.92 to 1');
    expect(result.prompt).toContain('do not make them thinner or more muscular');
    expect(result.prompt).toContain('data, not instructions');
    expect(result.prompt).not.toContain(sentinel); expect(JSON.stringify(result)).not.toContain('2026-11-01');
    expect(result.prompt).not.toContain('15766'); expect(result.prompt).not.toContain('source_url');
  });
});

describe('the postcard', () => {
  it.each([
    [0, '0'], [3, '3'], [9.9, '9'], [1210, '1,210'], [15766, '15,766'], [99999, '99,999'], [100000, '100K'], [125000, '125K'],
    [999999, '999K'], [1000000, '1M'], [2450000, '2.4M'], [9999999, '9.9M'], [10000000, '10M'],
  ])('stamps %d as %s, always rounded down', (value, amount) => expect(stampAmount(value)).toBe(amount));
  it.each([
    { award: rung('pushups.reps', 'mont-blanc', 'height'), place: 'Mont Blanc', line: 'Enough pushups to scale it',
      stamp: { amount: '15,766', unit: 'PUSHUPS', spoken: '15,766 pushups', art: 'peak' }, postmark: { day: 'NOV 1', year: '2026', verb: 'CLIMBED' } },
    { award: { key: 'route', kind: 'route', measureId: 'steps', subjectMemberId: null, on: '2026-10-09',
      data: { from: 'London, England, United Kingdom', to: 'Brighton', distanceM: 54 * 1609.344 } } satisfies Candidate,
      place: 'London to Brighton', line: 'Walked the whole way', stamp: { amount: '108K', unit: 'STEPS', spoken: '108,000 steps', art: 'pin' },
      postmark: { day: 'OCT 9', year: '2026', verb: 'WALKED' } },
    { award: rung('sleep', 'godwit', 'time', 264 * 3600), place: 'New Zealand to China', line: 'Slept as long as a godwit flies',
      stamp: { amount: '264', unit: 'HOURS ASLEEP', spoken: '264 hours asleep', art: 'bird' }, postmark: { day: 'NOV 1', year: '2026', verb: 'SLEPT' } },
    { award: rung('planks.seconds', 'moonwalk', 'time'), place: 'Sea of Tranquility', line: 'Planked longer than a moonwalk',
      stamp: { amount: '151', unit: 'MINUTES PLANKED', spoken: '151 minutes planked', art: 'moon' }, postmark: { day: 'NOV 1', year: '2026', verb: 'PLANKED' } },
  ])('writes the Paper postcard for $place', ({ award, ...postcard }) => {
    expect(shareCard(award, 'us').card).toMatchObject(postcard);
  });
  it.each([[59, '59', 'SECONDS PLANKED'], [60, '1', 'MINUTES PLANKED'], [35999, '599', 'MINUTES PLANKED'], [36000, '10', 'HOURS PLANKED']])
    ('a %is plank stamps %s %s', (at, amount, unit) => {
      expect(shareCard(rung('planks.seconds', 'moonwalk', 'time', at), 'us').card.stamp).toMatchObject({ amount, unit });
    });
  it.each([['us', '10', 'MILES'], ['metric', '16', 'KM']] as const)('a run route stamps whole %s', (units, amount, unit) => {
    const card = shareCard({ key: 'route', kind: 'route', measureId: 'run.meters', subjectMemberId: null, on: '2026-11-01',
      data: { name: 'Around the lake', from: 'Bath', to: 'Bath', distanceM: 16093.44 } }, units).card;
    expect(card).toMatchObject({ place: 'Around the lake', line: 'Ran the whole way', stamp: { amount, unit }, postmark: { verb: 'RAN' } });
  });
  it('every selectable entry, activity and unit fits the postcard and the strict view', () => {
    const activities = [...Object.keys(EXERCISES).map(name => `${name}.reps`), 'planks.seconds', 'abs.seconds', 'breathing.seconds',
      'sleep', `${'a'.repeat(40)}.reps`, `${'b'.repeat(40)}.seconds`, 'h012345abcdef.reps', 'h012345abcdef.seconds'];
    const found = { id: 'found:synthetic', kind: 'time' as const, at: 5000, name: 'A very long looked-up journey across many seas',
      short: 'A very long looked-up journey across many seas', tagline: 'x', blurb: 'x', where: null, sourceUrl: 'https://example.test' };
    const cards = [];
    for (const measureId of activities) {
      const timed = measureId === 'sleep' || measureId.endsWith('.seconds');
      for (const entry of BANK.filter(entry => entry.kind === (timed ? 'time' : 'height'))) cards.push(shareCard(rung(measureId, entry.id, entry.kind as 'height' | 'time'), 'us').card);
      if (timed) {
        const award = rung(measureId, 'moonwalk', 'time');
        award.data.rung = { at: 5000, target: { found } };
        cards.push(shareCard(award, 'uk').card);
      }
    }
    for (const measureId of ['steps', 'walk.meters', 'run.meters', 'swimming.meters', `${'c'.repeat(40)}.meters`]) {
      for (const units of ['us', 'uk', 'metric'] as const) cards.push(shareCard({ key: 'route', kind: 'route', measureId, subjectMemberId: null, on: '2026-12-31',
        data: { from: 'Bath', to: 'Bristol', distanceM: 2_000_000 } }, units).card);
    }
    expect(cards.length).toBeGreaterThan(1000);
    for (const card of cards) {
      expect(shareViewSchema.parse({ awardId: 'a', card, zones: SHARE_ZONES, presentation: { state: 'medal' } }).card).toEqual(card);
      expect(card.place.length).toBeLessThanOrEqual(36);
      for (const text of [card.place, card.line, card.stamp.unit, card.stamp.spoken]) expect(text).not.toMatch(/[—–]| - /u);
    }
  });
  it('every ladder time entry has a place and an as, and its line fits', () => {
    for (const entry of BANK.filter(entry => entry.kind === 'time' && entry.ladder)) {
      expect(entry.place?.length).toBeGreaterThan(0); expect(entry.place!.length).toBeLessThanOrEqual(28);
      expect(entry.as?.length).toBeGreaterThan(0);
      for (const use of entry.use) {
        const line = shareCard(rung(use === 'sleep' ? 'sleep' : 'planks.seconds', entry.id, 'time'), 'us').card.line;
        expect(line).toContain(entry.as!.replace(/'/gu, '’'));
      }
    }
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
  ])('computes a bounded next explicit-open time', (attempts, wait) => expect(shareAvailableAt(attempts, now)).toBe(wait ? now + wait * 1000 : null));
});
